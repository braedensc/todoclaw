import { z } from 'zod'
import { DayPlanSchema } from './plan'

// One source of truth: this Zod schema validates `daily_state` rows at the Supabase
// boundary and its inferred type IS the app's DailyState type. Mirrors
// supabase/migrations/*_create_daily_state.sql.
//
// `date` is the user's LOCAL calendar day (YYYY-MM-DD) — computed with
// src/lib/dates.ts `localDateInTZ(timezone)`, never server-UTC. The maps are jsonb
// objects keyed by id; `subtask_done` uses the composite key "habitId:subtaskId".

export const DailyStateSchema = z.object({
  user_id: z.string(),
  date: z.string(), // YYYY-MM-DD, user-local (see header)
  done: z.record(z.string(), z.boolean()), // { taskId: true }
  done_at: z.record(z.string(), z.string()), // { taskId: ISO instant }
  habit_done: z.record(z.string(), z.boolean()), // { habitId: true }
  subtask_done: z.record(z.string(), z.boolean()), // { "habitId:subtaskId": true }
  // Today's persisted Plan My Day result, or null/absent if not planned today (new column,
  // 20260703000000_daily_plan.sql). `.catch(null)` makes a malformed stored plan degrade to
  // "no plan" instead of failing the whole row parse — a bad plan must never break the
  // completion maps this row primarily carries.
  plan: DayPlanSchema.nullable().optional().catch(null),
})

export type DailyState = z.infer<typeof DailyStateSchema>
