import { describe, expect, it } from 'vitest'
import { RedeemInviteSchema } from './invite'

describe('RedeemInviteSchema', () => {
  const valid = { code: 'ABCDEF123', email: 'new@example.com', password: 'hunter2!' }

  it('accepts a well-formed redemption', () => {
    expect(RedeemInviteSchema.safeParse(valid).success).toBe(true)
  })

  it('trims the code and email', () => {
    const parsed = RedeemInviteSchema.parse({ ...valid, code: '  ABC  ', email: '  a@b.co ' })
    expect(parsed.code).toBe('ABC')
    expect(parsed.email).toBe('a@b.co')
  })

  it('rejects an empty code', () => {
    expect(RedeemInviteSchema.safeParse({ ...valid, code: '   ' }).success).toBe(false)
  })

  it('rejects a malformed email', () => {
    expect(RedeemInviteSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
  })

  it('rejects a password under 8 characters', () => {
    expect(RedeemInviteSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false)
  })
})
