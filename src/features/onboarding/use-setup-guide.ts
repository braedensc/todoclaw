import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useUserSchedule } from '../schedule/use-user-schedule'
import { useTasks } from '../tasks/use-tasks'
import { detectApplePlatform, isStandalone } from '../notifications/use-push-subscription'
import {
  DISMISSED_KEY,
  PLAN_DONE_KEY,
  TOUR_DONE_KEY,
  readFlag,
  subscribeSetupGuide,
  dismissSetupGuide,
  markPlanTried,
} from './setup-guide-store'

// use-setup-guide — the state behind the first-run "Get set up" card. Five steps, each
// AUTO-DETECTED rather than self-reported, because every one leaves an observable trace:
//   1. Take the tour       → latched in localStorage when the user finishes the FeatureTour.
//   2. Install as an app   → display-mode: standalone (checks itself off when the user reopens
//      Todoclaw from the Home Screen / Dock — the install gesture happens OUTSIDE the page, so a
//      step-by-step wizard could never survive it; a persistent card with live detection does).
//   3. Daily notifications → config.notifications.enabled (account half, from user_schedule) AND
//      Notification.permission granted (device half) — the same two halves the dispatcher requires.
//   4. Add a first task    → any task exists (the row itself is the trace; completing a task
//      hides it behind the daily done-map without deleting it, so the check regresses only if
//      the user deletes every task — fine for a first-run nudge).
//   5. Try Plan My Day     → a plan exists today; latched in localStorage so the checkmark doesn't
//      regress when the plan box clears at local midnight.
// Completion state is computed live per device; only the dismissal + latches persist (the store).

/** Which install gesture applies here. 'unknown' (e.g. Firefox desktop) hides the install step. */
export type InstallContext = 'ios' | 'macos-safari' | 'chromium' | 'unknown'

// Chromium's programmatic-install event (Chrome/Edge/Android). Not in lib.dom — declared locally.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
}

function detectInstallContext(): InstallContext {
  const apple = detectApplePlatform()
  if (apple !== 'other') return apple
  if (typeof navigator !== 'undefined' && /Chrome|Chromium|Edg\//.test(navigator.userAgent))
    return 'chromium'
  return 'unknown'
}

export interface SetupGuideState {
  /** Render the card at all. False once dismissed — or for a user who was already fully set up. */
  visible: boolean
  /** The "See how Todoclaw works" tour has been finished on this device. */
  tourDone: boolean
  install: {
    /** The step is only shown where an install gesture exists ('unknown' → hidden). */
    shown: boolean
    done: boolean
    context: InstallContext
    /** Chromium handed us a deferred beforeinstallprompt — promptInstall() opens the native dialog. */
    canPrompt: boolean
    promptInstall: () => void
  }
  notificationsDone: boolean
  /** At least one task exists — the "add your first task" step's trace. */
  taskAdded: boolean
  planDone: boolean
  doneCount: number
  stepCount: number
  allDone: boolean
  dismiss: () => void
}

export function useSetupGuide(planReady: boolean): SetupGuideState {
  const dismissed = useSyncExternalStore(subscribeSetupGuide, () => readFlag(DISMISSED_KEY))
  const planLatched = useSyncExternalStore(subscribeSetupGuide, () => readFlag(PLAN_DONE_KEY))
  const tourDone = useSyncExternalStore(subscribeSetupGuide, () => readFlag(TOUR_DONE_KEY))
  const schedule = useUserSchedule()
  const tasks = useTasks()

  // ---- Step 2: installed as an app. Standalone can't change without a relaunch, so a
  // per-render read is stable within a session.
  const context = detectInstallContext()
  const installed = isStandalone()
  const installShown = context !== 'unknown'

  // Capture Chromium's deferred install prompt while the card is up. preventDefault() suppresses
  // the browser's own install UI in favor of our button; when the card isn't showing we don't
  // register at all, leaving the browser's default behavior alone.
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  useEffect(() => {
    if (dismissed || installed || context !== 'chromium') return
    const onPrompt = (e: Event): void => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [dismissed, installed, context])
  const promptInstall = useCallback(() => {
    void promptEvent?.prompt()
  }, [promptEvent])

  // ---- Step 3: notifications. Account half + device half — permission is read live each render
  // (not from usePushSubscription's snapshot state) so enabling via the guide's inline button or
  // Settings flips the check as soon as the config save re-renders us.
  const notifEnabled = schedule.data?.config?.notifications?.enabled === true
  const permissionGranted =
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  const notificationsDone = notifEnabled && permissionGranted

  // ---- Step 4: a first task exists.
  const taskAdded = (tasks.data?.length ?? 0) > 0

  // ---- Step 5: Plan My Day — live today, or latched from an earlier day.
  const planDone = planReady || planLatched
  useEffect(() => {
    if (planReady && !planLatched) markPlanTried()
  }, [planReady, planLatched])

  const steps = [
    tourDone,
    ...(installShown ? [installed] : []),
    notificationsDone,
    taskAdded,
    planDone,
  ]
  const allDone = steps.every(Boolean)
  const doneCount = steps.filter(Boolean).length

  // Don't judge completion until the schedule row AND the task list have loaded — otherwise a
  // fully-set-up user briefly reads as incomplete and the card flashes.
  const loaded = !schedule.isLoading && !tasks.isLoading

  // A user who is ALREADY fully set up should never see the card: if every step is done before
  // the card has ever rendered incomplete this session, dismiss silently. If the last step
  // completes while the card is open, keep it up in its finished state so the user sees the
  // payoff and closes it themselves. Latched via a render-time state adjustment (the sanctioned
  // derive-state pattern — see SettingsPanel's hydration) rather than a ref write in render.
  const [sawIncomplete, setSawIncomplete] = useState(false)
  if (!dismissed && loaded && !allDone && !sawIncomplete) setSawIncomplete(true)
  useEffect(() => {
    if (dismissed || !loaded) return
    if (allDone && !sawIncomplete) dismissSetupGuide()
  }, [dismissed, loaded, allDone, sawIncomplete])

  return {
    visible: !dismissed && loaded && (sawIncomplete || !allDone),
    tourDone,
    install: {
      shown: installShown,
      done: installed,
      context,
      canPrompt: promptEvent !== null,
      promptInstall,
    },
    notificationsDone,
    taskAdded,
    planDone,
    doneCount,
    stepCount: steps.length,
    allDone,
    dismiss: dismissSetupGuide,
  }
}
