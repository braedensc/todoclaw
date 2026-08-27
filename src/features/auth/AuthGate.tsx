import { useState } from 'react'
import { AuthForm } from './AuthForm'
import { AuthMascot } from './AuthMascot'
import { RedeemInviteForm } from './RedeemInviteForm'
import { UpdatePasswordForm } from './UpdatePasswordForm'
import { recoveryLanding } from '../../lib/recovery-landing'

// AuthGate — the pre-auth surface: sign in, or redeem an invite (ADR-0030). A texted invite link
// (`/#/redeem?code=…`) lands here (the user has no session yet) and opens the redeem form with the
// code pre-filled; otherwise the sign-in form shows with a quiet toggle to switch. The redeem
// route is read from the hash directly rather than via lib/route's AppRoute union, which is for
// the signed-in shell only.
//
// It also hosts the password-recovery screen (TOD-87). That one is unusual: the recovery link has
// already established a session by the time it renders, so App routes it here explicitly rather
// than by the absence of a session. Hosting it here keeps one card + mascot for every auth
// surface — including the mascot's eye-cover on password focus, which listens document-wide.
function parseRedeemHash(hash: string): { redeem: boolean; code: string } {
  if (!hash.startsWith('#/redeem')) return { redeem: false, code: '' }
  const query = hash.split('?')[1] ?? ''
  return { redeem: true, code: new URLSearchParams(query).get('code') ?? '' }
}

export function AuthGate({ recovery }: { recovery?: { onDone: () => void } }) {
  const initial = parseRedeemHash(typeof window !== 'undefined' ? window.location.hash : '')
  const [mode, setMode] = useState<'signin' | 'redeem'>(initial.redeem ? 'redeem' : 'signin')
  // An expired or already-used reset link leaves no session, so it lands on the sign-in card with
  // nothing to explain itself. Say so, rather than letting it look like the link did nothing.
  const deadLink = !recovery && recoveryLanding.kind === 'dead-link'

  return (
    // The card + its mascot (style mix, login pass): TodoClaw peeks over the card's top edge —
    // the wrap's top margin reserves room for his head, and the -97px offset puts his chin-clip
    // line exactly on the card border (42.2/64 of his 150px height). He watches the cursor and
    // covers his eyes whenever a password field below has focus — including the redeem form's,
    // since AuthMascot listens document-wide. pointer-events-none keeps him out of the form.
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-3">
      <div className="relative mt-[72px] w-full">
        <AuthMascot className="pointer-events-none absolute left-1/2 top-[-97px] z-10 h-[150px] w-[150px] -translate-x-1/2" />
        <div className="rounded-2xl border border-border-strong bg-panel p-5 shadow-[0_1px_2px_rgba(46,42,36,0.05),0_18px_44px_-18px_rgba(46,42,36,0.28)]">
          {deadLink && (
            <p className="mb-3 rounded-[10px] border border-border-strong bg-card px-3 py-2 text-sm text-accent">
              That reset link is no longer valid — they expire, and each one works once. Request a
              fresh one below.
            </p>
          )}
          {recovery ? (
            <UpdatePasswordForm onDone={recovery.onDone} />
          ) : mode === 'redeem' ? (
            <RedeemInviteForm initialCode={initial.code} onBackToSignIn={() => setMode('signin')} />
          ) : (
            <AuthForm />
          )}
        </div>
      </div>
      {!recovery && mode === 'signin' && (
        <button
          type="button"
          onClick={() => setMode('redeem')}
          className="text-sm text-muted hover:text-ink"
        >
          Have an invite code? Redeem it →
        </button>
      )}
    </div>
  )
}
