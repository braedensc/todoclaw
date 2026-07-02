// Shared constants for the DB-backed golden E2E suite (local Supabase only; see ADR-0018).

/**
 * Fixed test account. Created out-of-band via the Supabase admin API because the app is
 * sign-in-only (no sign-up UI — ADR-0014). Local stack only; these are not real credentials.
 */
export const TEST_USER = {
  email: 'e2e@todoclaw.test',
  password: 'e2e-golden-pw-2026',
} as const

/** Where the authenticated session (storageState) is persisted. Under a gitignored dir. */
export const AUTH_STATE_PATH = 'e2e/.auth/state.json'
