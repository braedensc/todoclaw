import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../../lib/supabase'

type Mode = 'signin' | 'signup'

// Minimal email/password auth for the Stage 1 skeleton. Real auth hardening
// (email confirmation, password policy, leaked-password protection) is configured
// in the cloud Supabase dashboard in PR #3; local dev has confirmations off.
export function AuthForm() {
  const [mode, setMode] = useState<Mode>('signin')
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

    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    if (error) {
      setError(error.message)
    } else if (mode === 'signup') {
      setNotice('Account created. If email confirmation is on, check your inbox.')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{mode === 'signin' ? 'Sign in' : 'Create account'}</h2>

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
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-slate-800 px-3 py-2 text-white disabled:opacity-50"
      >
        {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
      </button>

      <button
        type="button"
        onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        className="text-sm text-slate-500 underline"
      >
        {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
      </button>
    </form>
  )
}
