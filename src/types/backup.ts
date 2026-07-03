import { z } from 'zod'

// A planner snapshot row (public.backups). The client only LISTS backups (id/label/created_at)
// and triggers create/restore via RPCs — it never reads or constructs the `data` jsonb blob
// (that is written by create_backup and consumed server-side by restore_backup). So the list
// shape deliberately omits `data` and `user_id`.
export const BackupSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  created_at: z.string(),
})

export type Backup = z.infer<typeof BackupSchema>
