import { z } from 'zod'

// Recurring-task shape, stored as jsonb on the task row (planning/EISENCLAW-LOGIC-TO-PORT.md
// §9, html:123). `frequencyDays` = cadence; `lastDoneAt` = ISO timestamp of last completion
// (null until first done); `doneCount` = total completions (drives the `×N` badge at >= 3).
export const RecurringSchema = z.object({
  frequencyDays: z.number(),
  lastDoneAt: z.string().nullable(),
  doneCount: z.number(),
})

export type Recurring = z.infer<typeof RecurringSchema>

// One source of truth: the Zod schema validates rows at the Supabase boundary and
// its inferred type IS the app's Task type. Mirrors supabase/migrations/*_create_tasks.sql.
// timestamptz / jsonb come back over the wire as strings / parsed JSON.
export const TaskSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  text: z.string(),
  x: z.number().nullable(),
  y: z.number().nullable(),
  due: z.string().nullable(),
  staged: z.boolean(),
  // Only the 'oneoff' bucket exists (planning/EISENCLAW-LOGIC-TO-PORT.md, Discrepancy #8).
  // Nullable because Stage 1 rows were inserted without a bucket (the column has no default
  // yet). `recurring` is null for non-recurring tasks.
  bucket: z.literal('oneoff').nullable(),
  recurring: RecurringSchema.nullable(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
})

export type Task = z.infer<typeof TaskSchema>
