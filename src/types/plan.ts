import { z } from 'zod'

// One source of truth for the "Plan My Day" result shape. This Zod schema validates the plan
// at every frontend boundary — both the plan-my-day Edge Function response and the persisted
// `daily_state.plan` jsonb read back on load — and its inferred type IS the app's DayPlan type.
//
// The response half is load-bearing, not belt-and-braces: the plan a mutation returns is rendered
// AND written to daily_state, so anything that gets past this check becomes the user's stored plan.
// It once wasn't checked at all (just `if (!data?.plan)`), and a truncated emit_plan — truthy, but
// with no headline — rendered as a permanently blank plan card. Don't weaken it back to a
// truthiness test.
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

// A fixed time today — a task due today at a specific clock time. Not a rock: it is a point on the
// day the user doesn't choose, derived server-side from the board (never emitted by the model), so a
// timed appointment can't be squeezed out by the bigRock/smallRocks caps. See plan-prompt.ts
// deriveAnchors.
export const PlanAnchorSchema = z.object({
  task: z.string(),
  time: z.string(), // formatted wall-clock, e.g. "2:00 PM"
  // Rough cost of the commitment ("~half-day"), from the task's size; null when unsized. An anchor
  // is a block of the day, not a point in it — the planner subtracts it from the day's free hours.
  duration: z.string().nullish().catch(null),
  taskId: z.string().nullish().catch(null),
})

// A recurring chore due today (overdue / never done / due today). Like an anchor: derived
// server-side from the board, never emitted by the model, so the bigRock/smallRocks caps can't
// squeeze it off the card. See deriveChores in plan-prompt.ts.
export const PlanChoreSchema = z.object({
  task: z.string(),
  status: z.string(), // the cadence label, e.g. 'due today' / 'overdue 3d'
  taskId: z.string().nullish().catch(null),
})

// A grid task due now (overdue / due today). Derived server-side like an anchor or a chore, but it
// does NOT displace a rock: a task the planner scheduled appears both as its rock and here, because
// this strip exists so nothing due today can go missing from the card. See deriveDueToday.
export const PlanDueTodaySchema = z.object({
  task: z.string(),
  status: z.string(), // 'due today' / 'overdue 5d'
  taskId: z.string().nullish().catch(null),
})

// How many items each capped strip left off, so the card can render "+N more" instead of just
// stopping at the cap. Each count degrades to 0 rather than nuking the plan.
export const PlanStripOverflowSchema = z.object({
  anchors: z.number().nullish().catch(null),
  chores: z.number().nullish().catch(null),
  dueToday: z.number().nullish().catch(null),
})

export const DayPlanSchema = z.object({
  headline: z.string(),
  availableTime: z.string(),
  // Optional + `.catch(null)` like nudge: plans persisted before anchors existed simply lack the
  // field, and a malformed value degrades to no-anchors instead of nuking the whole plan.
  anchors: z.array(PlanAnchorSchema).nullish().catch(null),
  // Same optional + `.catch(null)` treatment as anchors, and for the same reasons: plans persisted
  // before chores existed simply lack the field, and a malformed value degrades to no-chores.
  chores: z.array(PlanChoreSchema).nullish().catch(null),
  // Same treatment again: a plan persisted before the due-now strip existed simply lacks the field,
  // and an old cached client that never sends it still validates during a deploy.
  dueToday: z.array(PlanDueTodaySchema).nullish().catch(null),
  // Same treatment: absent on any plan stored before the strips counted their own overflow.
  overflow: PlanStripOverflowSchema.nullish().catch(null),
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
export type PlanAnchor = z.infer<typeof PlanAnchorSchema>
export type PlanChore = z.infer<typeof PlanChoreSchema>
export type PlanDueToday = z.infer<typeof PlanDueTodaySchema>
export type PlanStripOverflow = z.infer<typeof PlanStripOverflowSchema>
export type PlanNudge = z.infer<typeof PlanNudgeSchema>
export type DayPlan = z.infer<typeof DayPlanSchema>
