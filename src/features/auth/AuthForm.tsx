import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../../lib/supabase'

// Sign-in only. Todoclaw is an invite-only app (Stage 4, ADR-0014): public sign-up is
// disabled in the Supabase Auth dashboard and accounts are created by owner invite, so the
// client offers no account-creation path. AI features run on the owner's key for every
// signed-in (trusted) user — see ADR-0015. Auth hardening (email confirmation, password
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Sign in</h2>

      <input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded border border-slate-300 px-3 py-2"
      />
      <input
        type="password"
        required
        minLength={6}
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded border border-slate-300 px-3 py-2"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-slate-800 px-3 py-2 text-white disabled:opacity-50"
      >
        {busy ? '…' : 'Sign in'}
      </button>

      <p className="text-sm text-muted">Invite-only — contact the owner for access.</p>
    </form>
  )
}
