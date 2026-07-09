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

// use-setup-guide — the state behind the first-run "Get set up" card. THREE visible steps, each
// AUTO-DETECTED rather than self-reported, because every one leaves an observable trace:
//   1. Take the tour        → latched in localStorage when the FeatureTour closes.
//   2. App + notifications  → config.notifications.enabled (account half, from user_schedule) AND
//      Notification.permission granted (device half) — the same two halves the dispatcher
//      requires. The install is guidance INSIDE this step (the wizard), not its own checkbox:
//      on iOS notifications can't be granted outside the installed app anyway, and the installed
//      app's fresh storage re-shows this card there with `install.done` auto-detected
//      (display-mode: standalone), so the flow survives the user switching contexts.
//   3. Add a task → plan    → a plan exists today (implies a task did); latched in localStorage
//      so the checkmark doesn't regress when the plan box clears at local midnight. `taskAdded`
//      (any task exists) is exposed separately so the step's button can evolve from
//      "Show me where" to "Plan my day".
// Completion state is computed live per device; only the dismissal + latches persist (the store).

/** Which install gesture applies here. 'unknown' (e.g. Firefox desktop) skips install guidance. */
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
  /** The "See how Todoclaw works" tour has been taken (or deliberately skipped) on this device. */
  tourDone: boolean
  /** Install facts for step 2's wizard — guidance, not a separate checkbox. */
  install: {
    done: boolean
    context: InstallContext
    /** Chromium handed us a deferred beforeinstallprompt — promptInstall() opens the native dialog. */
    canPrompt: boolean
    promptInstall: () => void
  }
  notificationsDone: boolean
  /** At least one task exists — evolves step 3's button from "Show me where" to "Plan my day". */
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

  // ---- Install facts (step 2 guidance). Standalone can't change without a relaunch, so a
  // per-render read is stable within a session.
  const context = detectInstallContext()
  const installed = isStandalone()

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

  // ---- Step 2: notifications. Account half + device half — permission is read live each render
  // (not from usePushSubscription's snapshot state) so enabling via the card's inline button, the
  // wizard, or Settings flips the check as soon as the config save re-renders us. On iOS a
  // browser tab has no Notification API at all, so this can only complete inside the installed
  // app — exactly the order the wizard teaches.
  const notifEnabled = schedule.data?.config?.notifications?.enabled === true
  const permissionGranted =
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  const notificationsDone = notifEnabled && permissionGranted

  // ---- Step 3: a task exists (button state), and a plan has been generated (the checkmark).
  const taskAdded = (tasks.data?.length ?? 0) > 0
  const planDone = planReady || planLatched
  useEffect(() => {
    if (planReady && !planLatched) markPlanTried()
  }, [planReady, planLatched])

  const steps = [tourDone, notificationsDone, planDone]
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
