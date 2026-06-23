import { z } from 'zod'

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
  // yet). `recurring` stays loose until Stage 3 models the recurring feature.
  bucket: z.literal('oneoff').nullable(),
  recurring: z.unknown().nullable(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
})

export type Task = z.infer<typeof TaskSchema>
