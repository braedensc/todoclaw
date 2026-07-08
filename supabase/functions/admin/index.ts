// admin — OWNER-ONLY. Backs the owner Admin panel. This first cut ships a read-only `get_overview`:
// AI spend (global pool + per-user roster), system stats, integration status, and the current
// guardrail config. The write path (set_config) lands in a follow-up.
//
// Owner gate is the SAME server-side OWNER_USER_ID check as generate-invite (isOwner,
// _shared/owner.ts) — the frontend useIsOwner() only hides UI, so a non-owner who forces the page
// open still gets a 403 here. Privileged cross-user / global / auth.users reads go through the
// service_role adminClient() + the SECURITY DEFINER RPCs granted to service_role ONLY
// (20260707160000), reached only AFTER the owner check passes — matching the established grain
// (service_role has no direct table DML; everything is a fenced DEFINER RPC). Integration status is
// BOOLEANS only — no secret VALUES ever leave the server.
//
// Contract: POST { action: 'get_overview' } with a Bearer token → { config, globalSpend, roster,
// systemStats, integrations }.

import { z } from 'npm:zod@4.4.3'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { userClient, requireUser } from '../_shared/auth.ts'
import { isOwner } from '../_shared/owner.ts'
import { adminClient } from '../_shared/admin.ts'

const BodySchema = z.object({
  action: z.literal('get_overview'),
})

// Which server-side secrets / integrations are configured — BOOLEANS ONLY, never the values. Lets
// the panel show "Anthropic key: set / Web Push: not configured" without exposing anything.
function integrationStatus(): Record<string, boolean> {
  const has = (k: string) => Boolean(Deno.env.get(k))
  return {
    anthropicKey: has('ANTHROPIC_API_KEY'),
    ownerUserId: has('OWNER_USER_ID'),
    allowedOrigin: has('ALLOWED_ORIGIN'),
    dispatchSecret: has('DISPATCH_SECRET'),
    vapidPublicKey: has('VAPID_PUBLIC_KEY'),
    vapidPrivateKey: has('VAPID_PRIVATE_KEY'),
    vapidSubject: has('VAPID_SUBJECT'),
    spendAlertWebhook: has('AI_SPEND_ALERT_WEBHOOK_URL'),
  }
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

  const client = userClient(req)
  const user = await requireUser(client)
  if (!user) return json({ error: 'unauthorized' }, 401)

  // The REAL gate (the UI reveal is cosmetic). Unset OWNER_USER_ID ⇒ nobody is owner ⇒ 403.
  if (!isOwner(user.id, Deno.env.get('OWNER_USER_ID'))) return json({ error: 'forbidden' }, 403)

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})))
  } catch {
    return json({ error: 'invalid_request' }, 400)
  }

  try {
    // Privileged reads via the service_role admin client + DEFINER RPCs — reached only past the
    // owner gate above.
    const admin = adminClient()

    if (body.action === 'get_overview') {
      const [configRes, globalRes, rosterRes, statsRes] = await Promise.all([
        admin.rpc('app_config_get'),
        admin.rpc('ai_budget_status_admin'),
        admin.rpc('ai_user_spend_roster'),
        admin.rpc('admin_system_stats'),
      ])
      const firstError =
        configRes.error || globalRes.error || rosterRes.error || statsRes.error || null
      if (firstError) return json({ error: 'read_failed', detail: firstError.message }, 500)
      return json({
        config: configRes.data,
        globalSpend: globalRes.data,
        roster: rosterRes.data ?? [],
        systemStats: statsRes.data,
        integrations: integrationStatus(),
      })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (e) {
    return json({ error: 'admin_error', detail: e instanceof Error ? e.message : 'unknown' }, 500)
  }
})
