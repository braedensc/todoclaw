import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../../lib/supabase'

// Sign-in only. Todoclaw is an invite-only app (Stage 4, ADR-0014): public sign-up stays
// disabled, so this form offers no open account-creation path. Accounts are created by owner
// invite — either in the Supabase dashboard, or by redeeming an owner-generated invite code
// (ADR-0030, see RedeemInviteForm, reached via AuthGate). AI features run on the owner's key for
// every signed-in (trusted) user — see ADR-0015. Auth hardening (email confirmation, password
// policy, leaked-password protection) is configured in the cloud Supabase dashboard.
export function AuthForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    // Warm-paper theming (style mix, login pass) — this was the last slate-styled surface in
    // the app. Copy, placeholders, and control names are unchanged (pinned by AuthForm.test
    // and the golden auth.setup).
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">Sign in</h2>

      <input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-[10px] border border-border-strong bg-card px-3 py-2 text-sm text-ink placeholder:text-muted-faint focus:border-primary focus:outline-none"
      />
      <input
        type="password"
        required
        minLength={6}
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded-[10px] border border-border-strong bg-card px-3 py-2 text-sm text-ink placeholder:text-muted-faint focus:border-primary focus:outline-none"
      />

      {error && <p className="text-sm text-accent">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="rounded-[10px] bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? '…' : 'Sign in'}
      </button>

      <p className="text-center text-xs text-muted">Invite-only — contact the owner for access.</p>
    </form>
  )
}
