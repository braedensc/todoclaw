import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useUserSchedule } from '../schedule/use-user-schedule'
import { detectApplePlatform, isStandalone } from '../notifications/use-push-subscription'
import {
  DISMISSED_KEY,
  PLAN_DONE_KEY,
  readFlag,
  subscribeSetupGuide,
  dismissSetupGuide,
  markPlanTried,
} from './setup-guide-store'

// use-setup-guide — the state behind the first-run "Get set up" card. Three steps, each
// AUTO-DETECTED rather than self-reported, because every one leaves an observable trace:
//   1. Install as an app  → display-mode: standalone (checks itself off when the user reopens
//      Todoclaw from the Home Screen / Dock — the install gesture happens OUTSIDE the page, so a
//      step-by-step wizard could never survive it; a persistent card with live detection does).
//   2. Daily notifications → config.notifications.enabled (account half, from user_schedule) AND
//      Notification.permission granted (device half) — the same two halves the dispatcher requires.
//   3. Try Plan My Day     → a plan exists today; latched in localStorage so the checkmark doesn't
//      regress when the plan box clears at local midnight.
// Completion state is computed live per device; only the dismissal persists (see the store).

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
  planDone: boolean
  doneCount: number
  stepCount: number
  allDone: boolean
  dismiss: () => void
}

export function useSetupGuide(planReady: boolean): SetupGuideState {
  const dismissed = useSyncExternalStore(subscribeSetupGuide, () => readFlag(DISMISSED_KEY))
  const planLatched = useSyncExternalStore(subscribeSetupGuide, () => readFlag(PLAN_DONE_KEY))
  const schedule = useUserSchedule()

  // ---- Step 1: installed as an app. Standalone can't change without a relaunch, so a
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

  // ---- Step 2: notifications. Account half + device half — permission is read live each render
  // (not from usePushSubscription's snapshot state) so enabling via Settings flips the check as
  // soon as the config save re-renders us.
  const notifEnabled = schedule.data?.config?.notifications?.enabled === true
  const permissionGranted =
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  const notificationsDone = notifEnabled && permissionGranted

  // ---- Step 3: Plan My Day — live today, or latched from an earlier day.
  const planDone = planReady || planLatched
  useEffect(() => {
    if (planReady && !planLatched) markPlanTried()
  }, [planReady, planLatched])

  const steps = [...(installShown ? [installed] : []), notificationsDone, planDone]
  const allDone = steps.every(Boolean)
  const doneCount = steps.filter(Boolean).length

  // Don't judge completion until the schedule row has loaded — otherwise a fully-set-up user
  // briefly reads as incomplete and the card flashes.
  const scheduleLoaded = !schedule.isLoading

  // A user who is ALREADY fully set up should never see the card: if every step is done before
  // the card has ever rendered incomplete this session, dismiss silently. If the last step
  // completes while the card is open, keep it up in its finished state so the user sees the
  // payoff and closes it themselves. Latched via a render-time state adjustment (the sanctioned
  // derive-state pattern — see SettingsPanel's hydration) rather than a ref write in render.
  const [sawIncomplete, setSawIncomplete] = useState(false)
  if (!dismissed && scheduleLoaded && !allDone && !sawIncomplete) setSawIncomplete(true)
  useEffect(() => {
    if (dismissed || !scheduleLoaded) return
    if (allDone && !sawIncomplete) dismissSetupGuide()
  }, [dismissed, scheduleLoaded, allDone, sawIncomplete])

  return {
    visible: !dismissed && scheduleLoaded && (sawIncomplete || !allDone),
    install: {
      shown: installShown,
      done: installed,
      context,
      canPrompt: promptEvent !== null,
      promptInstall,
    },
    notificationsDone,
    planDone,
    doneCount,
    stepCount: steps.length,
    allDone,
    dismiss: dismissSetupGuide,
  }
}
