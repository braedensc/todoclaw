import { useState } from 'react'
import { AuthForm } from './AuthForm'
import { RedeemInviteForm } from './RedeemInviteForm'

// AuthGate — the pre-auth surface: sign in, or redeem an invite (ADR-0029). A texted invite link
// (`/#/redeem?code=…`) lands here (the user has no session yet) and opens the redeem form with the
// code pre-filled; otherwise the sign-in form shows with a quiet toggle to switch. The redeem
// route is read from the hash directly rather than via lib/route's AppRoute union, which is for
// the signed-in shell only.
function parseRedeemHash(hash: string): { redeem: boolean; code: string } {
  if (!hash.startsWith('#/redeem')) return { redeem: false, code: '' }
  const query = hash.split('?')[1] ?? ''
  return { redeem: true, code: new URLSearchParams(query).get('code') ?? '' }
}

export function AuthGate() {
  const initial = parseRedeemHash(typeof window !== 'undefined' ? window.location.hash : '')
  const [mode, setMode] = useState<'signin' | 'redeem'>(initial.redeem ? 'redeem' : 'signin')

  if (mode === 'redeem') {
    return <RedeemInviteForm initialCode={initial.code} onBackToSignIn={() => setMode('signin')} />
  }

  return (
    <div className="flex flex-col gap-3">
      <AuthForm />
      <button
        type="button"
        onClick={() => setMode('redeem')}
        className="text-sm text-muted hover:text-ink"
      >
        Have an invite code? Redeem it →
      </button>
    </div>
  )
}
