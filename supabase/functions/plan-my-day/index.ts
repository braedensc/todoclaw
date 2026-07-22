// plan-my-day — generates a schedule-aware daily plan. The frontend sends the day's tasks /
// recurring-due / habits (built from its existing scoring + recurring lib); this function reads
// the user's schedule + timezone server-side (authoritative), fetches cached weather, and calls
// Anthropic with FORCED tool use (emit_plan) so the result is always structured + parseable.
// Guarded by the per-user rate limit (plan_my_day) + the global budget kill-switch (ADR-0015).

import type Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { userClient, requireUser } from '../_shared/auth.ts'
import { anthropic, MODEL, MAX_TOKENS } from '../_shared/anthropic.ts'
import { precheck, recordUsage } from '../_shared/guardrails.ts'
import { ipThrottleOk } from '../_shared/ip-throttle.ts'
import { getWeather } from '../_shared/weather.ts'
import {
  PlanRequestSchema,
  SYSTEM_PROMPT,
  EMIT_PLAN_TOOL,
  buildUserPrompt,
  resolvePlanTaskIds,
  type EmittedPlan,
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
    const location = typeof config?.location === 'string' ? config.location.trim() : ''
    const weather = location ? await getWeather(client, location) : null

    const a = anthropic()
    const msg = await a.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(payload, config, weather, memories) }],
      tools: [EMIT_PLAN_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: 'tool', name: 'emit_plan' },
    })

    // Record actual token cost against the budget ledger (best-effort).
    await recordUsage(
      client,
      gate.usageId,
      msg.usage.input_tokens,
      msg.usage.output_tokens,
      'plan_my_day',
    )

    const toolUse = msg.content.find((b) => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') return json({ error: 'no_plan' }, 502)
    // Resolve emitted refs → real task ids before the client sees (and persists) the plan, so
    // each rock can be crossed off when its task is completed. See resolvePlanTaskIds.
    return json({ plan: resolvePlanTaskIds(toolUse.input as EmittedPlan, payload) })
  } catch (e) {
    // Log the real error server-side; return a generic code so no internal detail reaches the client.
    console.error('plan-my-day failed:', e)
    return json({ error: 'plan_failed' }, 500)
  }
})
