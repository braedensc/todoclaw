// generate-invite — OWNER-ONLY. Mints a redeemable invite code + shareable link so the owner can
// onboard someone by texting them a link, no Supabase dashboard needed (ADR-0030). The code is a
// bearer token that will create a trusted account on the owner's Anthropic key, so: only the owner
// (OWNER_USER_ID) may call this, codes are single-use by default and always expire, and the row is
// inserted under the caller's JWT (RLS `invites_insert_own`, owner_id defaults to auth.uid()).
// Contract: POST with a Bearer token → { code, url, maxUses, expiresAt }.

import { z } from 'npm:zod@4.4.3'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { userClient, requireUser } from '../_shared/auth.ts'
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

  const client = userClient(req)
  const user = await requireUser(client)
  if (!user) return json({ error: 'unauthorized' }, 401)

  // Owner gate. Enforced server-side (the frontend only HIDES the UI for non-owners). If
  // OWNER_USER_ID is unset, no one is the owner and generation is refused — a safe default.
  const ownerId = Deno.env.get('OWNER_USER_ID')
  if (!ownerId || user.id !== ownerId) return json({ error: 'forbidden' }, 403)

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

  const { data, error } = await client
    .from('invites')
    .insert({ code, max_uses: maxUses, expires_at: expiresAt }) // owner_id defaults to auth.uid()
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
