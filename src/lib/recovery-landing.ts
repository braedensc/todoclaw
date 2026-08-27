// What a Supabase auth email link left in the URL fragment, captured once at module load.
//
// Why capture instead of reading the hash where it is needed: the client runs auth-js's default
// `flowType: 'implicit'` + `detectSessionInUrl`, so a recovery link arrives as
// `#access_token=…&type=recovery`. auth-js consumes that fragment, saves a real session, and
// CLEARS `window.location.hash` during its own async initialization. It announces the difference
// between recovery and an ordinary sign-in exactly once — a `PASSWORD_RECOVERY` event emitted on a
// `setTimeout(…, 0)`, which a React `useEffect` subscription can lose the race to. Miss it and the
// recovery link is just a silent passwordless login that leaves the old password valid (TOD-87).
//
// Module bodies run synchronously and auth-js's clearing sits behind an `await`, so reading at
// import time always wins — no ordering dependency on lib/supabase and no event to catch. This
// module imports nothing on purpose: it stays cheap to import and testable without env vars.

export type RecoveryLanding = { kind: 'none' } | { kind: 'recovery' } | { kind: 'dead-link' }

/**
 * Classify a `location.hash`. Pure — the caller supplies the string.
 *
 * Note what this deliberately does NOT do: Supabase puts a human-readable `error_description`
 * in the fragment and we ignore it. Everything in the hash is attacker-supplied (anyone can
 * craft a link whose fragment says whatever they like), so the UI uses its own fixed copy
 * rather than reflecting URL text back at the user.
 */
export function parseRecoveryLanding(hash: string): RecoveryLanding {
  const raw = hash.replace(/^#/, '')
  // An app route (`#/done`, `#/redeem?code=…`) is not a token payload — bail before
  // URLSearchParams parses `/redeem?code=abc` into keys nobody wrote.
  if (!raw || raw.startsWith('/')) return { kind: 'none' }

  const params = new URLSearchParams(raw)
  if (params.get('type') === 'recovery') return { kind: 'recovery' }
  // A used, expired, or tampered link returns `#error=access_denied&error_code=otp_expired&…`.
  if (params.get('error') || params.get('error_code')) return { kind: 'dead-link' }
  return { kind: 'none' }
}

export const recoveryLanding: RecoveryLanding = parseRecoveryLanding(
  typeof window === 'undefined' ? '' : window.location.hash,
)
