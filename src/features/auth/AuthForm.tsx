import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../../lib/supabase'

// Sign-in only. TodoClaw is an invite-only app (Stage 4, ADR-0014): public sign-up stays
// disabled, so this form offers no open account-creation path. Accounts are created by owner
// invite — either in the Supabase dashboard, or by redeeming an owner-generated invite code
// (ADR-0030, see RedeemInviteForm, reached via AuthGate). AI features run on the owner's key for
// every signed-in (trusted) user — see ADR-0015. Auth hardening (email confirmation, password
// policy, leaked-password protection) is configured in the cloud Supabase dashboard.
//
// Recovery (TOD-87) is the one path out of here that does not need the owner: "Forgot password?"
// mails a reset link, which lands back on UpdatePasswordForm via lib/recovery-landing.

// Deliberately the same answer whether or not the address has an account — a reset form that
// says "no such user" is an account-existence oracle for anyone who wants to enumerate.
const RESET_SENT =
  'If an account exists for that address, a reset link is on its way. Check your email.'
const RESET_UNREACHABLE =
  'We couldn’t reach the server to send that link. Check your connection and try again.'
// GoTrue delivers the mail *before* it answers, so a slow sender makes this request slow. Rather
// than spin forever, say something true after a while: the send may well still land, and telling
// someone to retry immediately just walks them into the rate limit.
const RESET_SLOW =
  'That’s taking longer than usual. The link may still arrive — give it a minute before retrying.'
const RESET_TIMEOUT_MS = 15_000

/**
 * Reject if `promise` has not settled within `ms`.
 *
 * Needed because `resetPasswordForEmail` takes no AbortSignal, so the app-update fetch's
 * `AbortSignal.timeout` trick (lib/app-update.ts) does not apply here. This does not cancel the
 * request — nothing can — it only stops the UI waiting on it forever.
 */
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function AuthForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Separate from `busy` on purpose: sharing one flag put the "…" on the SIGN IN button while a
  // reset was in flight, which reads as "sign-in broke" rather than "your link is sending".
  const [resetBusy, setResetBusy] = useState(false)

  // Every await here is wrapped: supabase-js returns { error } for auth failures but THROWS on a
  // network fault, and an unhandled rejection skips the `setBusy(false)` that follows it — which
  // is a spinner that never stops and no message at all. `finally` is the only safe home for it.
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } catch {
      setError(RESET_UNREACHABLE)
    } finally {
      setBusy(false)
    }
  }

  async function handleForgotPassword() {
    setError(null)
    setNotice(null)
    if (!email.trim()) {
      setError('Enter your email address first, then tap “Forgot password?”.')
      return
    }

    setResetBusy(true)
    try {
      // redirectTo has to be on the Supabase redirect allow-list, or Auth silently falls back to
      // site_url and mails a link pointing somewhere the app isn't — see supabase/config.toml.
      const { error: resetErr } = await withTimeout(
        supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
        RESET_TIMEOUT_MS,
      )
      // GoTrue answers 200 for an unknown address precisely so this cannot enumerate, so an error
      // here is something else worth showing (rate limit, bad address) — never "no such user".
      if (resetErr) setError(resetErr.message)
      else setNotice(RESET_SENT)
    } catch (err) {
      setNotice(null)
      setError(err instanceof Error && err.message === 'timeout' ? RESET_SLOW : RESET_UNREACHABLE)
    } finally {
      setResetBusy(false)
    }
  }

  return (
    // Warm-paper theming (style mix, login pass) — this was the last slate-styled surface in
    // the app. Copy, placeholders, and control names are unchanged (pinned by AuthForm.test
    // and the golden auth.setup).
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">Sign in</h2>
      <p className="text-sm text-muted">AI plans your day. A puppy delivers it.</p>

      <input
        type="email"
        required
        placeholder="you@example.com"
        autoComplete="email"
        enterKeyHint="next"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-[10px] border border-border-strong bg-card px-3 py-2 text-sm text-ink placeholder:text-muted-faint focus:border-primary focus:outline-none"
      />
      <input
        type="password"
        required
        // Deliberately 6, not the 8 that new passwords require: this field accepts an EXISTING
        // password, and raising it would lock out any account created before the policy did.
        minLength={6}
        placeholder="Password"
        autoComplete="current-password"
        enterKeyHint="go"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded-[10px] border border-border-strong bg-card px-3 py-2 text-sm text-ink placeholder:text-muted-faint focus:border-primary focus:outline-none"
      />

      {error && <p className="text-sm text-accent">{error}</p>}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      <button
        type="submit"
        disabled={busy || resetBusy}
        className="rounded-[10px] bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? '…' : 'Sign in'}
      </button>

      <button
        type="button"
        onClick={handleForgotPassword}
        disabled={busy || resetBusy}
        // aria-live so a screen reader announces the send finishing; the visible notice below is
        // the sighted half of the same feedback.
        aria-live="polite"
        className="text-center text-xs text-muted hover:text-ink disabled:opacity-50"
      >
        {resetBusy ? 'Sending reset link…' : 'Forgot password?'}
      </button>

      <p className="text-center text-xs text-muted">Invite-only — contact the owner for access.</p>
    </form>
  )
}
