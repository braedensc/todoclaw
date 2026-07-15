import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { RedeemInviteSchema } from '../../types/invite'

// RedeemInviteForm — the pre-auth surface a new user reaches from a texted invite link
// (`/#/redeem?code=…`) or the "Have an invite code?" toggle on the sign-in form (ADR-0030). It
// posts { code, email, password } to the redeem-invite Edge Function, which validates+claims the
// code and creates the account; on success we immediately sign in with the same credentials, so
// useSession flips the app to the signed-in shell. No account is ever created client-side.

// Server error slug → friendly copy. The Edge Function returns these on non-2xx; anything
// unmapped falls back to a generic message.
const REDEEM_ERRORS: Record<string, string> = {
  invalid_code: 'That invite code isn’t valid. Double-check it with whoever invited you.',
  code_expired: 'This invite has expired. Ask the owner for a fresh link.',
  code_used_up: 'This invite has already been used. Ask the owner for a fresh link.',
  code_revoked: 'This invite was revoked. Ask the owner for a fresh link.',
  too_many_attempts: 'Too many attempts — please wait a few minutes and try again.',
  email_taken: 'An account already exists for that email. Try signing in instead.',
  invalid_request: 'Please check the code, email, and password (at least 8 characters).',
}

// supabase.functions.invoke surfaces a non-2xx response as a FunctionsHttpError whose `context` is
// the raw Response. Read the JSON body to recover our { error: slug } contract. Best-effort.
async function errorSlug(err: unknown): Promise<string> {
  const ctx = (err as { context?: Response } | null)?.context
  if (!ctx || typeof ctx.json !== 'function') return ''
  try {
    const body = (await ctx.json()) as { error?: string }
    return typeof body?.error === 'string' ? body.error : ''
  } catch {
    return ''
  }
}

export function RedeemInviteForm({
  initialCode = '',
  onBackToSignIn,
}: {
  initialCode?: string
  onBackToSignIn: () => void
}) {
  const [code, setCode] = useState(initialCode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const parsed = RedeemInviteSchema.safeParse({ code, email, password })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check your details and try again.')
      return
    }

    setBusy(true)
    const { error: invokeErr } = await supabase.functions.invoke('redeem-invite', {
      body: parsed.data,
    })
    if (invokeErr) {
      const slug = await errorSlug(invokeErr)
      setError(
        REDEEM_ERRORS[slug] ?? 'Something went wrong redeeming your invite. Please try again.',
      )
      setBusy(false)
      return
    }

    // Account created — sign in with the credentials the user just set. onAuthStateChange
    // (useSession) then re-renders straight into the app; this component unmounts, so leave busy on.
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    })
    if (signInErr) {
      // Rare: account exists but auto sign-in failed. Send them to the normal sign-in form.
      setError('Your account is ready — please sign in with your new email and password.')
      setBusy(false)
      onBackToSignIn()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">Redeem your invite</h2>
      <p className="text-sm text-muted">
        You were invited to Todoclaw — an AI-powered planner with a puppy at the helm. Enter your
        code and pick a password to create your account.
      </p>

      <input
        type="text"
        required
        placeholder="Invite code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="rounded-[10px] border border-border-strong bg-card px-3 py-2 font-mono text-sm tracking-wide text-ink placeholder:text-muted-faint focus:border-primary focus:outline-none"
      />
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
        minLength={8}
        placeholder="Choose a password (8+ characters)"
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
        {busy ? '…' : 'Create account & sign in'}
      </button>

      <button type="button" onClick={onBackToSignIn} className="text-sm text-muted hover:text-ink">
        ← Back to sign in
      </button>
    </form>
  )
}
