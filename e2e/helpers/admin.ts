import { TEST_USER } from './constants'

/**
 * Idempotently ensure the fixed test account exists. The app is sign-in-only (ADR-0014), so the
 * user is created out-of-band via the Supabase admin API with the service_role key and
 * `email_confirm: true` (no email round-trip). An "already registered" response is treated as
 * success so re-runs are safe.
 */
export async function ensureTestUser(apiUrl: string, serviceRoleKey: string): Promise<void> {
  const res = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      email: TEST_USER.email,
      password: TEST_USER.password,
      email_confirm: true,
    }),
  })

  if (res.ok) return

  // Idempotent: a re-run hits the existing account. Match ONLY the specific "already
  // registered / email exists" signal — not every 422 — so a genuine validation failure (e.g. a
  // password-policy rejection) isn't silently swallowed here and left to surface later as a
  // confusing sign-in error.
  const body = await res.text()
  if (/already.*registered|email[_ ]?exists|already been registered/i.test(body)) return

  throw new Error(`Failed to create test user via admin API (${res.status}): ${body}`)
}
