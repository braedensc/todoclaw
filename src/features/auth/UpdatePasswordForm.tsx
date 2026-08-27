import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../../lib/supabase'

// Minimum password length. Kept in step with RedeemInviteForm's input and
// `minimum_password_length` in supabase/config.toml — the client is the friendly half of the
// rule, the server is the enforcing half, and they should say the same number.
export const MIN_PASSWORD_LENGTH = 8

// UpdatePasswordForm — the screen a password-recovery link lands on (TOD-87).
//
// By the time this renders, auth-js has already exchanged the link's fragment for a real
// session. That session is what authorizes updateUser() below, and it is also why this screen
// has to pre-empt the signed-in shell rather than sit behind the auth gate: without it a
// recovery link is just a silent passwordless login that resets nothing and leaves the old
// password working.
export function UpdatePasswordForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Please use at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Those two passwords don’t match.')
      return
    }

    setBusy(true)
    const { error: updateErr } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateErr) {
      // This is also how the hosted leaked-password (HIBP) rejection arrives — an ordinary
      // auth error. Surface it verbatim so the user learns their choice was found in a breach
      // instead of staring at a generic failure.
      setError(updateErr.message)
      return
    }
    onDone()
  }

  // Leaving must not strand a usable session that skipped the change: the link already signed
  // this person in, so backing out has to sign them back out.
  async function handleCancel() {
    setBusy(true)
    await supabase.auth.signOut()
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">Choose a new password</h2>
      <p className="text-sm text-muted">
        You followed a password reset link. Pick a new password to finish — your old one stays
        active until you do.
      </p>

      <input
        type="password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}
        autoComplete="new-password"
        enterKeyHint="next"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded-[10px] border border-border-strong bg-card px-3 py-2 text-sm text-ink placeholder:text-muted-faint focus:border-primary focus:outline-none"
      />
      <input
        type="password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        placeholder="Confirm new password"
        autoComplete="new-password"
        enterKeyHint="go"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="rounded-[10px] border border-border-strong bg-card px-3 py-2 text-sm text-ink placeholder:text-muted-faint focus:border-primary focus:outline-none"
      />

      {error && <p className="text-sm text-accent">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="rounded-[10px] bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? '…' : 'Save new password'}
      </button>

      <button
        type="button"
        onClick={handleCancel}
        disabled={busy}
        className="text-center text-xs text-muted hover:text-ink disabled:opacity-50"
      >
        Cancel and sign out
      </button>
    </form>
  )
}
