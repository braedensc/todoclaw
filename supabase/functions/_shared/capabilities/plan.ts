// capabilities/plan.ts — generate_plan. This is the one capability that needs the owner's
// Anthropic key, so it does NOT reach for it directly (that would pull Anthropic into the
// transport-agnostic layer). Instead it calls the injected ctx.services.generatePlan, which
// ai-chat wires to ../run-plan.ts — the server-side Plan My Day path (its own plan_my_day
// rate-limit + budget gate, persists onto today's daily_state row). An MCP host that doesn't
// wire the service still loads this capability; it just reports planning is unavailable.

import { z } from 'npm:zod@4.4.3'
import { defineCapability, type Capability } from './types.ts'
import { ok, err } from './helpers.ts'

export const planCapabilities: Capability[] = [
  defineCapability({
    name: 'generate_plan',
    description:
      "Generate today's focused plan (Plan My Day) from the user's grid, recurring chores, habits, schedule and weather, and show it in the plan card above the grid. Use when the user asks to plan their day.",
    schema: z.object({}).strict(),
    async execute(ctx) {
      if (!ctx.services?.generatePlan) return err('Planning is not available right now.')
      const res = await ctx.services.generatePlan()
      if (!res.ok) return err(res.reason)
      // The plan is persisted onto today's daily_state row; invalidating that domain hydrates
      // the inline plan card. Keep the model's narration short — the card shows the detail.
      return ok(`Planned the day — ${res.headline}`, ['daily_state'])
    },
  }),
]
