// run-plan.ts — the server-side Plan My Day path, callable IN-PROCESS (not over HTTP). It is what
// BabyClaw's generate_plan tool triggers: it carries its own plan_my_day rate-limit + budget gate
// (separate from the chat's), reads the schedule/weather server-side, calls Anthropic with forced
// tool use (emit_plan), and PERSISTS the result onto today's daily_state row via save_daily_plan —
// exactly like the plan-my-day Edge Function, but building the day's inputs from the DB instead of
// a client payload. Injected into the capability layer as ctx.services.generatePlan.

import type Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { precheck, recordUsage } from './guardrails.ts'
import { anthropic, MODEL, MAX_TOKENS } from './anthropic.ts'
import { getWeather } from './weather.ts'
import { localDateInTZ } from './dates.ts'
import { buildPlanRequest } from './plan-inputs.ts'
import {
  SYSTEM_PROMPT,
  EMIT_PLAN_TOOL,
  buildUserPrompt,
  type ScheduleConfig,
  type PlanResult,
} from './plan-prompt.ts'

export type PlanRunResult = { ok: true; headline: string } | { ok: false; reason: string }

export async function runPlanForUser(
  client: SupabaseClient,
  timeZone: string,
  now: Date = new Date(),
): Promise<PlanRunResult> {
  // Separate plan_my_day rate limit + budget kill-switch (records this request).
  const gate = await precheck(client, 'plan_my_day')
  if (!gate.ok) {
    return {
      ok: false,
      reason:
        gate.reason === 'budget-exhausted'
          ? 'AI is paused for this month (the budget cap was reached).'
          : "You've reached today's plan limit — try again tomorrow.",
    }
  }

  try {
    const date = localDateInTZ(timeZone, now)
    const [schedRes, tasksRes, habitsRes, dailyRes] = await Promise.all([
      client.from('user_schedule').select('config').maybeSingle(),
      client.from('tasks').select('id, text, x, y, due, staged, recurring').is('deleted_at', null),
      client.from('habits').select('text, active').is('deleted_at', null),
      client.from('daily_state').select('done').eq('date', date).maybeSingle(),
    ])

    const config = (schedRes.data?.config ?? null) as ScheduleConfig | null
    const doneMap = (dailyRes.data?.done ?? {}) as Record<string, boolean>
    const location = (config?.location as string) ?? 'Atlanta'
    const weather = await getWeather(client, location)

    const req = buildPlanRequest(tasksRes.data ?? [], habitsRes.data ?? [], doneMap, timeZone, now)

    const a = anthropic()
    const msg = await a.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(req, config, weather) }],
      tools: [EMIT_PLAN_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: 'tool', name: 'emit_plan' },
    })
    await recordUsage(client, gate.usageId, msg.usage.input_tokens, msg.usage.output_tokens)

    const toolUse = msg.content.find((b) => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return { ok: false, reason: 'The planner did not return a plan.' }
    }
    const plan = toolUse.input as PlanResult
    const { error } = await client.rpc('save_daily_plan', { p_date: date, p_plan: plan })
    if (error) return { ok: false, reason: error.message }
    return { ok: true, headline: plan.headline }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Planning failed.' }
  }
}
