// ai-status — the PR2 proof endpoint. Returns the caller's AI budget/rate-limit state so the
// UI can show an "AI paused this month" banner and remaining-usage hints. It does NOT call
// Anthropic — its job is to exercise the whole AI request path end-to-end (CORS lock, JWT
// verification, the SECURITY DEFINER budget RPC, RLS-scoped usage reads) before any model
// feature is built on it. Contract: GET/POST with a Bearer access token → AiStatus JSON.

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { userClient, requireUser } from '../_shared/auth.ts'
import { getStatus } from '../_shared/guardrails.ts'
import { ipThrottleOk } from '../_shared/ip-throttle.ts'

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
  if (!(await ipThrottleOk(req, 'ai-status', 300, 60)))
    return json({ error: 'too_many_requests' }, 429)

  const client = userClient(req)
  const user = await requireUser(client)
  if (!user) return json({ error: 'unauthorized' }, 401)

  try {
    return json(await getStatus(client))
  } catch (_e) {
    return json({ error: 'status_failed' }, 500)
  }
})
