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

export function AuthForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) setError(error.message)
    setBusy(false)
  }

  async function handleForgotPassword() {
    setError(null)
    setNotice(null)
    if (!email.trim()) {
      setError('Enter your email address first, then tap “Forgot password?”.')
      return
    }

    setBusy(true)
    // redirectTo has to be on the Supabase redirect allow-list, or Auth silently falls back to
    // site_url and mails a link pointing somewhere the app isn't — see supabase/config.toml.
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    setBusy(false)

    // GoTrue answers 200 for an unknown address precisely so this cannot enumerate, so an error
    // here is something else worth showing (rate limit, malformed address) — never "no such user".
    if (resetErr) {
      setError(resetErr.message)
      return
    }
    setNotice(RESET_SENT)
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
        disabled={busy}
        className="rounded-[10px] bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? '…' : 'Sign in'}
      </button>

      <button
        type="button"
        onClick={handleForgotPassword}
        disabled={busy}
        className="text-center text-xs text-muted hover:text-ink disabled:opacity-50"
      >
        Forgot password?
      </button>

      <p className="text-center text-xs text-muted">Invite-only — contact the owner for access.</p>
    </form>
  )
}
