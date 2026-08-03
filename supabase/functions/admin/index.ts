// admin — backs the owner Admin panel. Two actions on one Bearer-authenticated endpoint:
//
//   • whoami       — ANY authenticated caller. Returns { isOwner } about the CALLER ONLY, so the
//                    frontend can decide whether to reveal the (otherwise hidden) admin entry
//                    WITHOUT the owner's user id ever being shipped to the client. A non-owner just
//                    gets { isOwner: false } (a plain 200) — it leaks nothing about who the owner is.
//   • get_overview — OWNER-ONLY, read-only: AI spend (global pool + per-user roster), system stats,
//                    integration status, and the current guardrail config. 403 for non-owners. The
//                    write path (set_config) lands in a follow-up.
//
// Owner gate is the SAME server-side OWNER_USER_ID check as generate-invite (isOwner,
// _shared/owner.ts) — the frontend useIsOwner() only hides UI, so a non-owner who forces the page
// open still gets a 403 here. Privileged cross-user / global / auth.users reads go through the
// service_role adminClient() + the SECURITY DEFINER RPCs granted to service_role ONLY
// (20260707160000), reached only AFTER the owner check passes — matching the established grain
// (service_role has no direct table DML; everything is a fenced DEFINER RPC). Integration status is
// BOOLEANS only — no secret VALUES ever leave the server.
//
// Contract: POST { action: 'whoami' } → { isOwner }; POST { action: 'get_overview' } (owner only) →
// { config, globalSpend, roster, systemStats, integrations }. Both require a Bearer token.

import { z } from 'npm:zod@4.4.3'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { userClient, requireUser } from '../_shared/auth.ts'
import { isOwner } from '../_shared/owner.ts'
import { adminClient } from '../_shared/admin.ts'
import { ipThrottleOk } from '../_shared/ip-throttle.ts'

const BodySchema = z.object({
  action: z.enum(['whoami', 'get_overview']),
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

  // Coarse per-IP flood guard, before auth (verify_jwt is off for this function).
  if (!(await ipThrottleOk(req, 'admin', 120, 60))) return json({ error: 'too_many_requests' }, 429)

  const client = userClient(req)
  const user = await requireUser(client)
  if (!user) return json({ error: 'unauthorized' }, 401)

  // The REAL gate (the UI reveal is cosmetic). Unset OWNER_USER_ID ⇒ nobody is owner.
  const owner = isOwner(user.id, Deno.env.get('OWNER_USER_ID'))

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})))
  } catch {
    return json({ error: 'invalid_request' }, 400)
  }

  // whoami is the ONE action any authenticated caller may run: it answers only "are YOU the owner?"
  // — a boolean about the caller, never the owner's identity — so the client can reveal the admin
  // entry without ever learning the owner's user id. Non-owners get { isOwner: false }, not a 403.
  if (body.action === 'whoami') return json({ isOwner: owner })

  // Everything past here is strictly owner-only.
  if (!owner) return json({ error: 'forbidden' }, 403)

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
