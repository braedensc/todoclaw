import { z } from 'zod'

// One source of truth: this Zod schema validates `history` rows at the Supabase boundary
// and its inferred type IS the app's History type. Mirrors
// supabase/migrations/*_history_and_daily_state_rpc.sql.
//
// History is the permanent, append-only completion log behind the Done tab. It is
// DENORMALIZED on purpose: `text` and `bucket` are snapshots taken at completion time, so
// a row survives a later task soft-delete. `task_id` is kept (nullable, no FK) only to
// drive restore-eligibility (is the task still in today's daily_state.done map?).
// timestamptz comes back over the wire as an ISO string.
export const HistorySchema = z.object({
  id: z.string(),
  user_id: z.string(),
  task_id: z.string().nullable(), // nullable, no FK — snapshot is the source of truth
  text: z.string(), // snapshot of the task text at completion time
  bucket: z.string().nullable(), // snapshot of the task bucket
  completed_at: z.string(), // ISO instant
  created_at: z.string(), // ISO instant
})

export type History = z.infer<typeof HistorySchema>
