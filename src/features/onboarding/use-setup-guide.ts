import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useUserSchedule } from '../schedule/use-user-schedule'
import { useTasks } from '../tasks/use-tasks'
import { detectApplePlatform, isStandalone } from '../notifications/use-push-subscription'
import {
  DISMISSED_KEY,
  PLAN_DONE_KEY,
  TOUR_DONE_KEY,
  readFlag,
  readRequested,
  subscribeSetupGuide,
  dismissSetupGuide,
  markPlanTried,
} from './setup-guide-store'

// use-setup-guide — the state behind the first-run "Get set up" card. Each step is AUTO-DETECTED
// rather than self-reported, because every one leaves an observable trace:
//   1. Take the tour        → localStorage when the FeatureTour closes, MIRRORED to the account
//      (config.onboarding.tourSeen) so the checkmark survives the browser↔installed-app storage
//      partition split — the tour is a device-independent fact (see use-mark-tour-seen.ts).
//   2. Install the app      → running as the installed app (display-mode: standalone). Its OWN step
//      now (2026-07-09): the old combined "install + notifications" step let users think they were
//      done after installing, when notifications still waited — splitting them tracks each plainly.
//      Absent on platforms with no install gesture ('unknown', e.g. Firefox desktop).
//   3. Turn on notifications → config.notifications.enabled (account half) AND Notification.permission
//      granted (device half) — the same two halves the dispatcher requires.
//   4. Add a task → plan     → a plan exists today (implies a task did); latched in localStorage so
//      the checkmark doesn't regress when the plan box clears at local midnight.
// STEP ORDER is platform-adaptive. On Apple (iOS / macOS Safari) notifications CANNOT be granted
// until the app is installed — iOS Safari tabs have no Notification API at all — so install must
// come first there. Everywhere else notifications work in the browser, so they come first and the
// (non-disruptive-first) install lands last, per the 2026-07-09 request.

/** Which install gesture applies here. 'unknown' (e.g. Firefox desktop) skips install guidance. */
export type InstallContext = 'ios' | 'macos-safari' | 'chromium' | 'unknown'

/** The setup steps, keyed. `order` below sequences the ones that apply to this platform. */
export type SetupStepKey = 'tour' | 'install' | 'notifications' | 'plan'

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

/** Apple platforms gate notifications behind the install — so install must be the earlier step. */
function isApple(context: InstallContext): boolean {
  return context === 'ios' || context === 'macos-safari'
}

/** The step sequence for a platform: install only exists where there's a real install gesture. */
function stepOrder(context: InstallContext): SetupStepKey[] {
  if (context === 'unknown') return ['tour', 'notifications', 'plan']
  if (isApple(context)) return ['tour', 'install', 'notifications', 'plan']
  return ['tour', 'notifications', 'install', 'plan']
}

export interface SetupGuideState {
  /** Render the card at all. False once dismissed — or for a user who was already fully set up. */
  visible: boolean
  /** Ordered step keys for THIS platform — drives render order, numbering, and the counts. */
  order: SetupStepKey[]
  /** Per-step completion, keyed (SetupGuide renders `order` and looks each step up here). */
  done: Record<SetupStepKey, boolean>
  /** The "See how Todoclaw works" tour has been taken (or deliberately skipped). */
  tourDone: boolean
  /** Install facts for the install step's wizard + its own checkmark. */
  install: {
    done: boolean
    context: InstallContext
    /** Chromium handed us a deferred beforeinstallprompt — promptInstall() opens the native dialog. */
    canPrompt: boolean
    promptInstall: () => void
  }
  notificationsDone: boolean
  /**
   * Notifications can be enabled in THIS context. False only on an iOS Safari tab (no Notification
   * API until the app is on the Home Screen) — the notifications step then points at the install
   * step instead of offering a button that can't work.
   */
  canEnableNotificationsHere: boolean
  /** At least one task exists — evolves the plan step's button from "Show me where" to "Plan my day". */
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
  const tourLatched = useSyncExternalStore(subscribeSetupGuide, () => readFlag(TOUR_DONE_KEY))
  // An explicit "Show the setup guide" (Settings) — forces the card up regardless of completion.
  const requested = useSyncExternalStore(subscribeSetupGuide, readRequested)
  const schedule = useUserSchedule()
  const tasks = useTasks()

  // ---- Install facts. Standalone can't change without a relaunch, so a per-render read is stable.
  const context = detectInstallContext()
  const installed = isStandalone()
  const order = stepOrder(context)

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

  // ---- Step 1: tour. Local latch OR the account mirror — the account half survives a browser↔PWA
  // storage-partition switch (the local flag lives in whichever context took the tour).
  const tourSeenAccount = schedule.data?.config?.onboarding?.tourSeen === true
  const tourDone = tourLatched || tourSeenAccount

  // ---- Notifications. Account half + device half — permission is read live each render (not from
  // usePushSubscription's snapshot) so enabling via the card's button, the wizard, or Settings
  // flips the check as soon as the config save re-renders us. On iOS a browser tab has no
  // Notification API, so this can only complete inside the installed app.
  const notifEnabled = schedule.data?.config?.notifications?.enabled === true
  const permissionGranted =
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  const notificationsDone = notifEnabled && permissionGranted
  // Apple platforms: enable only inside the installed app. iOS Safari tabs have no Notification API
  // at all; macOS Safari can push from a tab, but that permission wouldn't follow into the Dock app
  // — so on both we point at the install step first. Chromium/unknown enable right here.
  const canEnableNotificationsHere = !isApple(context) || installed

  // ---- Plan step: a task exists (button state), and a plan has been generated (the checkmark).
  const taskAdded = (tasks.data?.length ?? 0) > 0
  const planDone = planReady || planLatched
  useEffect(() => {
    if (planReady && !planLatched) markPlanTried()
  }, [planReady, planLatched])

  const done: Record<SetupStepKey, boolean> = {
    tour: tourDone,
    install: installed,
    notifications: notificationsDone,
    plan: planDone,
  }
  const activeDone = order.map((k) => done[k])
  const allDone = activeDone.every(Boolean)
  const doneCount = activeDone.filter(Boolean).length

  // Don't judge completion until the schedule row AND the task list have loaded — otherwise a
  // fully-set-up user briefly reads as incomplete and the card flashes.
  const loaded = !schedule.isLoading && !tasks.isLoading

  // A user who is ALREADY fully set up should never see the card: if every step is done before the
  // card has ever rendered incomplete this session, dismiss silently. If the last step completes
  // while the card is open, keep it up in its finished state so the user sees the payoff and closes
  // it themselves. Latched via a render-time state adjustment (the sanctioned derive-state pattern).
  // An explicit "Show the setup guide" (`requested`) overrides all of this — the user asked to see
  // it, so it stays up until they dismiss it (and the silent auto-dismiss must not stomp it while
  // the async account tour-mirror clear is still in flight — the source of the old two-click bug).
  const [sawIncomplete, setSawIncomplete] = useState(false)
  if (!dismissed && loaded && !allDone && !sawIncomplete) setSawIncomplete(true)
  useEffect(() => {
    if (dismissed || !loaded || requested) return
    if (allDone && !sawIncomplete) dismissSetupGuide()
  }, [dismissed, loaded, allDone, sawIncomplete, requested])

  return {
    visible: !dismissed && loaded && (requested || sawIncomplete || !allDone),
    order,
    done,
    tourDone,
    install: {
      done: installed,
      context,
      canPrompt: promptEvent !== null,
      promptInstall,
    },
    notificationsDone,
    canEnableNotificationsHere,
    taskAdded,
    planDone,
    doneCount,
    stepCount: order.length,
    allDone,
    dismiss: dismissSetupGuide,
  }
}
