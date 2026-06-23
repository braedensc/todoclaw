import { z } from 'zod'

// One source of truth: this Zod schema validates `user_schedule` rows at the Supabase
// boundary and its inferred type IS the app's UserSchedule type. Mirrors
// supabase/migrations/*_create_user_schedule.sql.
//
// `timezone` is hoisted to its own column because it drives the timezone-correct daily
// reset (see the migration). `config` (location / weekday / weekend / running — the Plan
// My Day context) is kept loose on purpose: its precise shape belongs to the AI stage
// that consumes it, and tightening a shape no code produces yet is dead-spec risk. The
// concrete sample lives at planning/eisenclaw-export/data/user-schedule-braeden.json.

export const UserScheduleSchema = z.object({
  user_id: z.string(),
  timezone: z.string().min(1), // IANA name, e.g. "America/New_York"
  config: z.record(z.string(), z.unknown()), // modeled by the Plan My Day stage
  created_at: z.string(),
  updated_at: z.string(),
})

export type UserSchedule = z.infer<typeof UserScheduleSchema>
