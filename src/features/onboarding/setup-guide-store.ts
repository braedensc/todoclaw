// Device-local persistence for the first-run setup guide. The steps it tracks (install as an
// app, enable notifications) are per-DEVICE facts — a user who finished setup on their laptop
// still needs the Home-Screen install on their phone — so dismissal lives in localStorage, not
// in the account's config. A tiny subscriber set makes the flags reactive: Settings' "Show the
// setup guide" can resurface the card in the already-mounted shell (useSyncExternalStore in
// use-setup-guide.ts reads through here).
//
// The golden E2E suite seeds DISMISSED_KEY before sign-in (e2e/golden/auth.setup.ts) so specs
// assert the established shell, not the guide.

export const DISMISSED_KEY = 'todoclaw.setup-guide.dismissed'
export const PLAN_DONE_KEY = 'todoclaw.setup-guide.plan-done'
export const TOUR_DONE_KEY = 'todoclaw.setup-guide.tour-done'

// localStorage can throw (some private-browsing modes); the guide is best-effort chrome, so a
// failed read shows the card again and a failed write means one extra dismissal — never a crash.
export function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    // best-effort
  }
}

// An explicit "Show the setup guide" (Settings) — the user ASKED to see it, so it must show even
// for a fully-set-up user and must not be silently auto-dismissed. Session-only (not persisted): a
// reload correctly reverts to the auto-dismiss-on-load behavior. This overrides a race that
// otherwise needs two clicks: the reset clears the LOCAL tour/plan latches synchronously, but the
// account tour-mirror (config.onboarding.tourSeen) is cleared by an async save, so on the click's
// synchronous render every step can still read "done" → allDone stays true for a beat → the silent
// auto-dismiss stomps the card. Forcing visibility sidesteps the lag entirely.
let requested = false

export function readRequested(): boolean {
  return requested
}

const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

export function subscribeSetupGuide(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function dismissSetupGuide(): void {
  // A deliberate dismissal ends any explicit "show" — the user is done looking at it.
  requested = false
  writeFlag(DISMISSED_KEY, true)
  emit()
}

/** Mark the "Try Plan My Day" step done for good — the plan box clears at local midnight, the checkmark shouldn't. */
export function markPlanTried(): void {
  writeFlag(PLAN_DONE_KEY, true)
  emit()
}

/** Mark the "See how TodoClaw works" tour finished on this device. */
export function markTourDone(): void {
  writeFlag(TOUR_DONE_KEY, true)
  emit()
}

/** Re-show the guide on this device (Settings → "Show the setup guide"). */
export function resetSetupGuide(): void {
  // Force the card visible until the user dismisses it — see `requested` above (why one click alone
  // wasn't enough for a fully-set-up user).
  requested = true
  writeFlag(DISMISSED_KEY, false)
  writeFlag(PLAN_DONE_KEY, false)
  writeFlag(TOUR_DONE_KEY, false)
  emit()
}
