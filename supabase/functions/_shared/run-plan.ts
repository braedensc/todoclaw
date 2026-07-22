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
import { HABITS_FETCH_LIMIT, TASKS_FETCH_LIMIT } from './write-caps.ts'
import {
  SYSTEM_PROMPT,
  EMIT_PLAN_TOOL,
  buildUserPrompt,
  resolvePlanTaskIds,
  type EmittedPlan,
  type PlanRequest,
  type ScheduleConfig,
  type PlanResult,
} from './plan-prompt.ts'

export type PlanRunResult = { ok: true; headline: string } | { ok: false; reason: string }

// The pure Anthropic call: build the prompt, force emit_plan, return the structured plan + token
// usage. Shared by the interactive path (runPlanForUser) and the proactive dispatcher (ADR-0031),
// which each supply their own inputs + guardrails. Throws if the model returns no tool use.
export async function generatePlan(
  a: Anthropic,
  req: PlanRequest,
  config: ScheduleConfig | null,
  weather: string | null,
  memories: string[] = [],
): Promise<{ plan: PlanResult; usage: { input: number; output: number } }> {
  const msg = await a.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(req, config, weather, memories) }],
    tools: [EMIT_PLAN_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: 'tool', name: 'emit_plan' },
  })
  const toolUse = msg.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('The planner did not return a plan.')
  }
  return {
    // Resolve each rock's emitted `ref` to a real tasks.id before anything stores or returns the
    // plan — daily_state.plan only ever holds the resolved shape (taskId, never ref).
    plan: resolvePlanTaskIds(toolUse.input as EmittedPlan, req),
    usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens },
  }
}

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
    const [schedRes, tasksRes, habitsRes, dailyRes, memRes] = await Promise.all([
      client.from('user_schedule').select('config').maybeSingle(),
      client
        .from('tasks')
        .select('id, text, x, y, due, due_time, staged, recurring, size, ongoing, start_date')
        .is('deleted_at', null)
        // Exclude permanently completed one-off tasks (tasks.completed_at) so a task done on a prior
        // day can't reappear in a generated plan — mirrors the dispatch RPC's completed_at filter.
        .is('completed_at', null)
        // Bounded fetch (write-caps.ts), newest first so truncation for an at-cap account drops
        // the stalest tail, not arbitrary rows.
        .order('created_at', { ascending: false })
        .limit(TASKS_FETCH_LIMIT),
      client.from('habits').select('text, active').is('deleted_at', null).limit(HABITS_FETCH_LIMIT),
      client.from('daily_state').select('done').eq('date', date).maybeSingle(),
      // Saved memories (RLS-scoped). Always fetched (≤30 rows); only USED when memory is on.
      client.from('assistant_memories').select('content').order('created_at', { ascending: true }),
    ])

    const config = (schedRes.data?.config ?? null) as ScheduleConfig | null
    // Kill switch: config.assistant.memoryEnabled === false ⇒ don't feed memories to the plan.
    const memoryOn = config?.assistant?.memoryEnabled !== false
    const memories = memoryOn
      ? ((memRes.data ?? []) as { content: string }[]).map((m) => m.content)
      : []
    const doneMap = (dailyRes.data?.done ?? {}) as Record<string, boolean>
    // No location set → skip the weather line entirely (don't default to any city's weather).
    const location = typeof config?.location === 'string' ? config.location.trim() : ''
    const weather = location ? await getWeather(client, location) : null

    const req = buildPlanRequest(tasksRes.data ?? [], habitsRes.data ?? [], doneMap, timeZone, now)

    const { plan, usage } = await generatePlan(anthropic(), req, config, weather, memories)
    await recordUsage(client, gate.usageId, usage.input, usage.output, 'plan_my_day')

    const { error } = await client.rpc('save_daily_plan', { p_date: date, p_plan: plan })
    if (error) {
      // Log the real DB error server-side; the user only ever gets a plain-language reason.
      console.error('save_daily_plan failed:', error)
      return { ok: false, reason: "I couldn't save your plan just now — please try again." }
    }
    return { ok: true, headline: plan.headline }
  } catch (e) {
    console.error('plan run failed:', e)
    return { ok: false, reason: "I couldn't plan your day just now — please try again." }
  }
}
