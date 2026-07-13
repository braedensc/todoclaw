// generate-invite — OWNER-ONLY. Mints a redeemable invite code + shareable link so the owner can
// onboard someone by texting them a link, no Supabase dashboard needed (ADR-0030). The code is a
// bearer token that will create a trusted account on the owner's Anthropic key, so: only the owner
// (OWNER_USER_ID) may call this, and codes are single-use by default and always expire.
// Contract: POST with a Bearer token → { code, url, maxUses, expiresAt }.
//
// The owner gate used to be enforced ONLY here while the insert went through the caller's JWT + the
// `invites_insert_own` RLS policy — which any authenticated user could bypass by POSTing to
// /rest/v1/invites directly (L3, 2026-07-13 audit). That direct path is now revoked
// (20260713020000): the insert runs through the service-role admin client, which bypasses RLS, so
// owner_id is set EXPLICITLY to the isOwner()-verified caller (there is no auth.uid() under service
// role). isOwner() remains the one gate; the DB simply no longer offers a second way in.

import { z } from 'npm:zod@4.4.3'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { userClient, requireUser } from '../_shared/auth.ts'
import { adminClient } from '../_shared/admin.ts'
import { isOwner } from '../_shared/owner.ts'
import { generateInviteCode, redeemUrl } from '../_shared/invite-code.ts'

const BodySchema = z
  .object({
    maxUses: z.number().int().min(1).max(50).optional(),
    expiresInDays: z.number().int().min(1).max(90).optional(),
  })
  .optional()

const DEFAULT_MAX_USES = 1
const DEFAULT_EXPIRES_DAYS = 7

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const cors = corsHeaders(req.headers.get('Origin'))
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  // Verify the caller from their JWT (RLS-scoped client, used only to establish identity here).
  const user = await requireUser(userClient(req))
  if (!user) return json({ error: 'unauthorized' }, 401)

  // Owner gate (shared with the admin function). Enforced server-side (the frontend only HIDES the
  // UI for non-owners). If OWNER_USER_ID is unset, no one is the owner and generation is refused.
  if (!isOwner(user.id, Deno.env.get('OWNER_USER_ID'))) return json({ error: 'forbidden' }, 403)

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})))
  } catch {
    return json({ error: 'invalid_request' }, 400)
  }

  const maxUses = body?.maxUses ?? DEFAULT_MAX_USES
  const expiresInDays = body?.expiresInDays ?? DEFAULT_EXPIRES_DAYS
  const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
  const code = generateInviteCode()

  // Insert via the service-role admin client (the ONLY invite insert path now — the direct
  // authenticated grant is revoked). Under service role there is no auth.uid(), so owner_id is set
  // explicitly to the verified owner. The DB CHECK constraints (max_uses ∈ [1,50], expires_at not
  // null) are a backstop under the Zod caps above.
  const { data, error } = await adminClient()
    .from('invites')
    .insert({ code, max_uses: maxUses, expires_at: expiresAt, owner_id: user.id })
    .select('code, max_uses, expires_at')
    .single()
  if (error || !data) return json({ error: 'insert_failed' }, 500)

  return json({
    code: data.code,
    url: redeemUrl(req.headers.get('Origin') ?? '', data.code),
    maxUses: data.max_uses,
    expiresAt: data.expires_at,
  })
})
