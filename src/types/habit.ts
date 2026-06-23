import { z } from 'zod'

// One source of truth: this Zod schema validates `habits` rows at the Supabase boundary
// and its inferred type IS the app's Habit type. Mirrors
// supabase/migrations/*_create_habits.sql. jsonb comes back already parsed.

// A subtask is embedded inline on the habit (no independent table) — see the migration.
export const SubtaskSchema = z.object({
  id: z.string(),
  text: z.string(),
})
export type Subtask = z.infer<typeof SubtaskSchema>

export const HabitSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  text: z.string(),
  active: z.boolean(),
  subtasks: SubtaskSchema.array(),
  created_at: z.string(),
  deleted_at: z.string().nullable(), // soft-delete: null = live
})

export type Habit = z.infer<typeof HabitSchema>
