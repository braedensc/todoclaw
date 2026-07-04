import { z } from 'zod'

// One source of truth for the "Plan My Day" result shape. This Zod schema validates the plan
// at every frontend boundary — both the plan-my-day Edge Function response and the persisted
// `daily_state.plan` jsonb read back on load — and its inferred type IS the app's DayPlan type.
//
// Mirrors the EMIT_PLAN_TOOL output schema in supabase/functions/_shared/plan-prompt.ts (the
// Deno edge runtime keeps its own copy — the two runtimes can't share a module). Keep them in
// sync: `when` is the fixed slot enum; bigRock is null on a light/rest day.

export const PLAN_WHEN_VALUES = ['morning', 'lunch', 'afternoon', 'evening'] as const
export const PlanWhenSchema = z.enum(PLAN_WHEN_VALUES)

export const PlanRockSchema = z.object({
  task: z.string(),
  why: z.string(),
  duration: z.string(),
  when: PlanWhenSchema,
})

export const DayPlanSchema = z.object({
  headline: z.string(),
  availableTime: z.string(),
  bigRock: PlanRockSchema.nullable(), // null on a light/rest day
  smallRocks: z.array(PlanRockSchema),
  habitNote: z.string(),
})

export type PlanWhen = z.infer<typeof PlanWhenSchema>
export type PlanRock = z.infer<typeof PlanRockSchema>
export type DayPlan = z.infer<typeof DayPlanSchema>
