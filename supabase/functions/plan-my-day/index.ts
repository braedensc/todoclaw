// plan-my-day — generates a schedule-aware daily plan. The frontend sends the day's tasks /
// recurring-due / habits (built from its existing scoring + recurring lib); this function reads
// the user's schedule + timezone server-side (authoritative), fetches cached weather, and calls
// Anthropic with FORCED tool use (emit_plan) so the result is always structured + parseable.
// Guarded by the per-user rate limit (plan_my_day) + the global budget kill-switch (ADR-0015).

import type Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { errorLabel } from '../_shared/safe-error.ts'
import { userClient, adminClient, requireUser } from '../_shared/auth.ts'
import { anthropic, MAX_TOKENS } from '../_shared/anthropic.ts'
import { precheck, recordUsage } from '../_shared/guardrails.ts'
import { loadConfig } from '../_shared/guardrails-config.ts'
import { ipThrottleOk } from '../_shared/ip-throttle.ts'
import { getWeather } from '../_shared/weather.ts'
import {
  PlanRequestSchema,
  SYSTEM_PROMPT,
  EMIT_PLAN_TOOL,
  buildUserPrompt,
  resolvePlanTaskIds,
  type ScheduleConfig,
} from '../_shared/plan-prompt.ts'

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
  if (!(await ipThrottleOk(req, 'plan-my-day', 120, 60)))
    return json({ error: 'too_many_requests' }, 429)

  const client = userClient(req)
  const user = await requireUser(client)
  if (!user) return json({ error: 'unauthorized' }, 401)

  let payload
  try {
    payload = PlanRequestSchema.parse(await req.json())
  } catch {
    return json({ error: 'invalid_request' }, 400)
  }

  // Guardrails: budget kill-switch + per-user rate limit (records the request, returns a usage id).
  const gate = await precheck(client, 'plan_my_day')
  if (!gate.ok) {
    return json({ error: gate.reason }, gate.reason === 'budget-exhausted' ? 503 : 429)
  }

  try {
    // Schedule + memories are read server-side (config is authoritative, not client-trusted; RLS
    // scopes both to the caller). Memories are only USED when the kill switch is on.
    const [{ data: scheduleRow }, memRes] = await Promise.all([
      client.from('user_schedule').select('config').maybeSingle(),
      client.from('assistant_memories').select('content').order('created_at', { ascending: true }),
    ])
    const config = (scheduleRow?.config ?? null) as ScheduleConfig | null
    const memoryOn = config?.assistant?.memoryEnabled !== false
    const memories = memoryOn
      ? ((memRes.data ?? []) as { content: string }[]).map((m) => m.content)
      : []
    // No location set → skip the weather line entirely (don't default to any city's weather).
    // The weather_cache is server-only (service_role): pass adminClient(), NOT the user client —
    // getWeather uses it solely for the cache RPCs (never a user table). See weather.ts / migration
    // 20260722000000.
    const location = typeof config?.location === 'string' ? config.location.trim() : ''
    const weather = location ? await getWeather(adminClient(), location) : null

    // Live plan model (owner-tunable, allowlisted — see guardrails-config.ts). Cached per isolate
    // ~30s; precheck above already warmed the same read.
    const cfg = await loadConfig(client)
    const a = anthropic()
    const msg = await a.messages.create({
      model: cfg.planModel,
      max_tokens: MAX_TOKENS,
      // Static system prompt + one ephemeral breakpoint (5-min TTL) caches tools + system
      // together; every plan call (this endpoint, run-plan.ts, the dispatch batch) shares the
      // same cache entry per model on the single owner key. Mirrors run-plan.ts generatePlan.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserPrompt(payload, config, weather, memories) }],
      tools: [EMIT_PLAN_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: 'tool', name: 'emit_plan' },
    })

    // Record actual token cost against the budget ledger (best-effort). With cache_control above,
    // input_tokens is the uncached remainder — the cache counts carry the rest of the bill.
    await recordUsage(
      client,
      gate.usageId,
      msg.usage.input_tokens,
      msg.usage.output_tokens,
      'plan_my_day',
      cfg.planModel,
      msg.usage.cache_creation_input_tokens ?? 0,
      msg.usage.cache_read_input_tokens ?? 0,
    )

    // A truncated response can still carry a tool_use block, but its JSON input is cut off — the
    // SDK hands back a partial object. Treat it as no plan rather than shipping the fragment.
    if (msg.stop_reason === 'max_tokens') return json({ error: 'no_plan' }, 502)

    const toolUse = msg.content.find((b) => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') return json({ error: 'no_plan' }, 502)
    // Validate the model's raw tool input, then resolve emitted refs → real task ids before the
    // client sees (and persists) the plan, so each rock can be crossed off when its task is
    // completed. Null = the emit wasn't a usable plan; failing here is what stops a contentless
    // plan reaching daily_state and rendering as a blank card. See resolvePlanTaskIds.
    const plan = resolvePlanTaskIds(toolUse.input, payload)
    if (!plan) return json({ error: 'no_plan' }, 502)
    return json({ plan })
  } catch (e) {
    // Classification only (an Anthropic error can embed the prompt's task titles — see
    // _shared/safe-error.ts); return a generic code so no internal detail reaches the client.
    console.error('plan-my-day failed:', errorLabel(e))
    return json({ error: 'plan_failed' }, 500)
  }
})
