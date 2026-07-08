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

const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

export function subscribeSetupGuide(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function dismissSetupGuide(): void {
  writeFlag(DISMISSED_KEY, true)
  emit()
}

/** Mark the "Try Plan My Day" step done for good — the plan box clears at local midnight, the checkmark shouldn't. */
export function markPlanTried(): void {
  writeFlag(PLAN_DONE_KEY, true)
  emit()
}

/** Re-show the guide on this device (Settings → "Show the setup guide"). */
export function resetSetupGuide(): void {
  writeFlag(DISMISSED_KEY, false)
  writeFlag(PLAN_DONE_KEY, false)
  emit()
}
