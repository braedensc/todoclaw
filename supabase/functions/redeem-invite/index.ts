// redeem-invite — PUBLIC (no JWT: this is how a brand-new user gets their first account). Turns a
// valid invite code + email + password into a Supabase Auth account (ADR-0030). `enable_signup`
// stays false — the ONLY way to create an account is here, and only against a code that passes the
// atomic claim. Ordering matters:
//   1. Zod-validate the body.
//   2. Per-IP throttle (defense-in-depth; code entropy is the real guard).
//   3. claim_invite_code — atomic, row-locked check-then-increment. Anything but 'ok' → 4xx.
//   4. auth.admin.createUser — the one step that genuinely needs the service-role admin client.
//   5. On createUser failure, RELEASE the claim so a duplicate email / transient error doesn't burn
//      the code; on success, write an audit row.
// Returns { ok: true } only — never credentials. The client then signs in with the creds it holds.
//
// The claim/throttle/release RPCs are granted to service_role only, so this function reaches them
// (and createUser) through the single admin client in _shared/admin.ts.

import { z } from 'npm:zod@4.4.3'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { adminClient } from '../_shared/admin.ts'

const RedeemSchema = z.object({
  code: z.string().min(1).max(64),
  email: z.string().email(),
  password: z.string().min(8).max(128),
})

const THROTTLE_LIMIT = 10 // attempts per IP …
const THROTTLE_WINDOW_SECONDS = 600 // … per 10 minutes

// claim_invite_code status → [client error slug, HTTP status].
const CLAIM_ERRORS: Record<string, [string, number]> = {
  invalid: ['invalid_code', 404],
  expired: ['code_expired', 410],
  used_up: ['code_used_up', 409],
  revoked: ['code_revoked', 410],
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const cors = corsHeaders(req.headers.get('Origin'))
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  let body: z.infer<typeof RedeemSchema>
  try {
    body = RedeemSchema.parse(await req.json())
  } catch {
    return json({ error: 'invalid_request' }, 400)
  }

  const admin = adminClient()

  // Throttle by client IP. x-forwarded-for may be absent (e.g. local serve) — the RPC treats a
  // missing IP as "allow, don't record" so it neither bypasses nor locks out redemption.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  const { data: allowed, error: throttleErr } = await admin.rpc('invite_throttle', {
    p_ip: ip,
    p_limit: THROTTLE_LIMIT,
    p_window_seconds: THROTTLE_WINDOW_SECONDS,
  })
  if (throttleErr) return json({ error: 'redeem_failed' }, 500)
  if (allowed === false) return json({ error: 'too_many_attempts' }, 429)

  // Atomically claim one use of the code.
  const { data: claim, error: claimErr } = await admin.rpc('claim_invite_code', {
    p_code: body.code,
  })
  if (claimErr) return json({ error: 'redeem_failed' }, 500)
  const status = (claim as { status?: string } | null)?.status ?? 'invalid'
  if (status !== 'ok') {
    const [slug, code] = CLAIM_ERRORS[status] ?? CLAIM_ERRORS.invalid
    return json({ error: slug }, code)
  }
  const inviteId = (claim as { invite_id: string }).invite_id

  // Create the account (immediate activation — the code is the owner's vouch).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
  })
  if (createErr || !created?.user) {
    // Don't permanently burn a use on a recoverable failure (e.g. email already registered).
    await admin.rpc('release_invite_claim', { p_invite_id: inviteId })
    const taken = (createErr?.message ?? '').toLowerCase().includes('already')
    return json({ error: taken ? 'email_taken' : 'account_create_failed' }, 400)
  }

  // Audit trail via the DEFINER RPC (best-effort — a bookkeeping hiccup must not fail an
  // already-created account). Routed through the RPC so invite_redemptions needs no DML grant.
  await admin.rpc('record_invite_redemption', {
    p_invite_id: inviteId,
    p_user_id: created.user.id,
  })

  return json({ ok: true })
})
