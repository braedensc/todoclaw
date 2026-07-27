// capabilities/plan.ts — generate_plan. This is the one capability that needs the owner's
// Anthropic key, so it does NOT reach for it directly (that would pull Anthropic into the
// transport-agnostic layer). Instead it calls the injected ctx.services.generatePlan, which
// ai-chat wires to ../run-plan.ts — the server-side Plan My Day path (its own plan_my_day
// rate-limit + budget gate, persists onto today's daily_state row). An MCP host that doesn't
// wire the service still loads this capability; it just reports planning is unavailable.

import { z } from 'npm:zod@4.4.3'
import { localDateInTZ } from '../dates.ts'
import { defineCapability, type Capability } from './types.ts'
import type { PlanResult } from '../plan-prompt.ts'
import { ok, err, systemErr } from './helpers.ts'

// Exactly what the plan card now shows, as one narratable line — the model's only view of the plan
// it just generated. Explicitly COMPLETE ("that is the whole plan") so a follow-up like "wait, isn't
// the car repair in there?" gets answered from the plan instead of from a guess about the panel.
export function planNarration(plan: PlanResult): string {
  const bits = [`Planned the day — ${plan.headline}`]
  if (plan.anchors.length) {
    bits.push(`Fixed times today: ${plan.anchors.map((a) => `${a.time} ${a.task}`).join('; ')}.`)
  }
  bits.push(plan.bigRock ? `Big rock: ${plan.bigRock.task}.` : 'No big rock (a light day).')
  if (plan.smallRocks.length) bits.push(`Then: ${plan.smallRocks.map((r) => r.task).join(', ')}.`)
  if (plan.nudge) bits.push(`Optional nudge: ${plan.nudge.task}.`)
  bits.push('That is the whole plan — nothing else is on the card.')
  return bits.join(' ')
}

export const planCapabilities: Capability[] = [
  defineCapability({
    name: 'generate_plan',
    description:
      "Generate today's focused plan (Plan My Day) from the user's board, recurring chores, habits, schedule and weather, and show it in the plan panel on the home screen (above the grid on desktop; on the mobile home view). Use when the user asks to plan their day.",
    schema: z.object({}).strict(),
    async execute(ctx) {
      if (!ctx.services?.generatePlan) return err('Planning is not available right now.')
      const res = await ctx.services.generatePlan()
      if (!res.ok) return err(res.reason)
      // The plan is persisted onto today's daily_state row; invalidating that domain hydrates
      // the inline plan card. The result spells out WHAT the card now shows: with only a headline
      // to go on, the model invented the rest and then defended items the card had dropped.
      return ok(planNarration(res.plan), ['daily_state'])
    },
  }),

  defineCapability({
    name: 'dismiss_plan',
    description:
      "Clear today's plan (the same as the × on the plan panel). Use when the user wants the day's plan dismissed or cleared. Does not touch tasks or habits.",
    schema: z.object({}).strict(),
    async execute(ctx) {
      // save_daily_plan(date, null) blanks today's daily_state.plan (SECURITY INVOKER, RLS-scoped) —
      // the same write the PlanBox × makes. A fresh local day already reads a plan-less row.
      const date = localDateInTZ(ctx.timeZone, ctx.now ?? new Date())
      const { error } = await ctx.client.rpc('save_daily_plan', { p_date: date, p_plan: null })
      if (error) return systemErr(error.message)
      return ok("Cleared today's plan.", ['daily_state'])
    },
  }),
]
