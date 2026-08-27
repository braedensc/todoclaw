import { describe, expect, it } from 'vitest'
import { parseRecoveryLanding } from './recovery-landing'

describe('parseRecoveryLanding', () => {
  it('recognizes a recovery link', () => {
    expect(
      parseRecoveryLanding('#access_token=abc123&refresh_token=def&type=recovery&expires_in=3600'),
    ).toEqual({ kind: 'recovery' })
  })

  it('recognizes a recovery link regardless of param order', () => {
    expect(parseRecoveryLanding('#type=recovery&access_token=abc123')).toEqual({ kind: 'recovery' })
  })

  it('treats an expired or already-used link as a dead link', () => {
    expect(
      parseRecoveryLanding(
        '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ),
    ).toEqual({ kind: 'dead-link' })
  })

  it('does not reflect the URL error_description — the copy is ours, not the link author’s', () => {
    // A crafted link can put arbitrary text in the fragment; the result carries none of it.
    const landing = parseRecoveryLanding('#error=access_denied&error_description=Call+555-0100+now')
    expect(landing).toEqual({ kind: 'dead-link' })
    expect(JSON.stringify(landing)).not.toContain('555')
  })

  it('ignores an ordinary app route', () => {
    expect(parseRecoveryLanding('#/done')).toEqual({ kind: 'none' })
    expect(parseRecoveryLanding('#/chat/abc-123')).toEqual({ kind: 'none' })
  })

  it('ignores the invite-redeem route, which also carries a query string', () => {
    expect(parseRecoveryLanding('#/redeem?code=ABC123')).toEqual({ kind: 'none' })
  })

  it('ignores an empty or bare hash', () => {
    expect(parseRecoveryLanding('')).toEqual({ kind: 'none' })
    expect(parseRecoveryLanding('#')).toEqual({ kind: 'none' })
  })

  it('ignores a non-recovery token payload (a magic-link sign-in)', () => {
    expect(parseRecoveryLanding('#access_token=abc&type=magiclink')).toEqual({ kind: 'none' })
  })
})
