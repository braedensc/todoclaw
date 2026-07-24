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
  // The tasks.id this rock came from (stamped server-side from the model's line ref), so the plan
  // card can strike a rock through once its task is done. Optional: plans persisted before the
  // field existed simply lack it, and `.catch(null)` keeps a malformed value (the column is
  // client-writable jsonb) from nuking the whole plan via DailyStateSchema's plan-level catch.
  taskId: z.string().nullish().catch(null),
})

// The optional "if you want something to do" suggestion on a quiet/relaxed day — a rock without a
// slot (never scheduled). See the emit_plan nudge in plan-prompt.ts.
export const PlanNudgeSchema = z.object({
  task: z.string(),
  why: z.string(),
  duration: z.string(),
  taskId: z.string().nullish().catch(null),
})

export const DayPlanSchema = z.object({
  headline: z.string(),
  availableTime: z.string(),
  bigRock: PlanRockSchema.nullable(), // null on a light/rest day
  smallRocks: z.array(PlanRockSchema),
  habitNote: z.string(),
  // Present only on a quiet/relaxed day (bigRock null). Optional + `.catch(null)` for the same
  // reasons as taskId: plans persisted before the field lack it, and a malformed value degrades to
  // no-nudge rather than nuking the whole plan.
  nudge: PlanNudgeSchema.nullish().catch(null),
})

export type PlanWhen = z.infer<typeof PlanWhenSchema>
export type PlanRock = z.infer<typeof PlanRockSchema>
export type PlanNudge = z.infer<typeof PlanNudgeSchema>
export type DayPlan = z.infer<typeof DayPlanSchema>
