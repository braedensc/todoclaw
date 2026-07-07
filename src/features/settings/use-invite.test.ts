import { describe, expect, it } from 'vitest'
import { inviteStatus, inviteLink, type Invite } from './use-invite'

const base: Invite = {
  id: 'i1',
  code: 'CODE',
  max_uses: 1,
  used_count: 0,
  expires_at: null,
  revoked: false,
  created_at: '2026-07-07T00:00:00Z',
}

describe('inviteStatus', () => {
  it('is active when unused, unexpired, and unrevoked', () => {
    expect(inviteStatus(base)).toBe('active')
  })

  it('reports revoked first, even if also used up or expired', () => {
    expect(inviteStatus({ ...base, revoked: true, used_count: 1 })).toBe('revoked')
  })

  it('is expired once past expires_at', () => {
    expect(inviteStatus({ ...base, expires_at: '2000-01-01T00:00:00Z' })).toBe('expired')
  })

  it('is used_up when used_count reaches max_uses', () => {
    expect(inviteStatus({ ...base, used_count: 3, max_uses: 3 })).toBe('used_up')
  })
})

describe('inviteLink', () => {
  it('builds a hash-routed redeem link with the code URL-encoded', () => {
    expect(inviteLink('A B')).toContain('/#/redeem?code=A%20B')
  })
})
