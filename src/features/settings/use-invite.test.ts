import { describe, expect, it, vi } from 'vitest'
import { generateInviteError, inviteStatus, inviteLink, type Invite } from './use-invite'

// use-invite imports lib/supabase, which throws at import without env vars (CI has none). These
// tests exercise only the pure helpers, so a bare stub is enough — same pattern as the other
// supabase-importing test files (see AuthForm.test.tsx). vi.mock is hoisted above the imports.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

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

describe('generateInviteError', () => {
  const httpError = (status: number, body: unknown) => ({
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status }),
  })

  it('turns each server slug into copy that names the fix', async () => {
    expect((await generateInviteError(httpError(401, { error: 'unauthorized' }))).message).toMatch(
      /session expired/i,
    )
    expect((await generateInviteError(httpError(403, { error: 'forbidden' }))).message).toMatch(
      /owner/i,
    )
    expect(
      (await generateInviteError(httpError(429, { error: 'too_many_requests' }))).message,
    ).toMatch(/wait a minute/i)
    expect(
      (await generateInviteError(httpError(400, { error: 'invalid_request' }))).message,
    ).toMatch(/1–50/)
    expect((await generateInviteError(httpError(500, { error: 'insert_failed' }))).message).toMatch(
      /couldn’t save/i,
    )
  })

  it('carries the status for an unmapped failure, so a bug report has a fact in it', async () => {
    expect((await generateInviteError(httpError(502, { error: 'who_knows' }))).message).toContain(
      'HTTP 502',
    )
  })

  it('reads as a connectivity problem when there was no response at all', async () => {
    expect((await generateInviteError(new TypeError('Failed to fetch'))).message).toMatch(
      /check your connection/i,
    )
  })

  // The whole point: the raw transport message never reaches the user again.
  it('never surfaces the FunctionsHttpError message', async () => {
    const err = await generateInviteError(httpError(403, { error: 'forbidden' }))
    expect(err.message).not.toContain('non-2xx')
  })
})
