// resolve-location — echo back the place wttr.in's geocoder ACTUALLY matched for a typed location,
// so the Settings field can confirm it instead of leaving the user guessing. No model call.
//
// Why this exists: wttr.in geocodes fuzzily and answers HTTP 200 for a typo — `Portlnad, OR`
// returns real weather for Roberts, Oregon. Weather then silently describes the wrong town, and
// because weather is optional context (getWeather swallows every failure by design), nothing
// downstream can tell. Resolving on save is the only point where a human can catch it.
//
// Contract: POST { location } + Bearer access token → 200 with a discriminated union:
//   { ok: true,  label: 'Portland, Oregon, United States of America' }
//   { ok: false, reason: 'not_found' | 'unavailable' }
// A failed lookup is a 200, not a 4xx: it's a SUCCESSFUL answer to "what does this match?" — and
// supabase.functions.invoke surfaces any non-2xx as a FunctionsHttpError whose body must be
// unwrapped from `context` (see RedeemInviteForm), which would buy nothing but client complexity.
// Real errors (unauthenticated, unparseable body) stay 4xx.
//
// Auth is checked BEFORE the body is read: the post-deploy smoke in deploy.yml POSTs `{}` with no
// token and fails the deploy on a 5xx, so the unauthenticated path must land on a clean 401.

import { z } from 'npm:zod@4.4.3'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { userClient, requireUser } from '../_shared/auth.ts'
import { resolveLocation } from '../_shared/weather.ts'

// Mirrors the `location` cap in src/types/user-schedule.ts (SHORT_MAX = 120).
const ResolveSchema = z.object({ location: z.string().trim().min(1).max(120) })

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

  let body: z.infer<typeof ResolveSchema>
  try {
    body = ResolveSchema.parse(await req.json())
  } catch {
    return json({ error: 'invalid_request' }, 400)
  }

  return json(await resolveLocation(body.location))
})
