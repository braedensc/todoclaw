import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { localDateInTZ } from '../../lib/dates'
import { HistorySchema, type History } from '../../types/history'

// The Done tab's data layer. The permanent completion log (history) plus the two
// daily_state mutations behind it (mark a task done / restore it). All three go through
// the server-side merge RPCs from the migration, never a client read-modify-write, so the
// per-day jsonb maps are updated atomically (no clobber race).

const HISTORY_KEY = ['history'] as const

// Fetch the signed-in user's permanent completion log, newest-first. RLS restricts rows to
// user_id = auth.uid(). History is append-only — there is no soft-delete column to filter.
async function fetchHistory(): Promise<History[]> {
  const { data, error } = await supabase
    .from('history')
    .select('*')
    .order('completed_at', { ascending: false })

  if (error) throw error
  return HistorySchema.array().parse(data)
}

export function useHistory() {
  return useQuery({ queryKey: HISTORY_KEY, queryFn: fetchHistory })
}

// Mark a task done TODAY. Calls set_task_done, which in ONE transaction merges
// done[id]=true + done_at[id]=now into today's daily_state row AND appends a history row
// (so there is no done-without-history window). user_id is auth.uid() server-side; the
// client only supplies the task snapshot + the user-local date.
//
// Invalidates BOTH the history query and today's daily_state query (same date key the read
// hook uses) so the Done tab and any consumer of today's `done` map refresh.
export function useMarkTaskDone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      taskId,
      text,
      bucket,
      timeZone,
    }: {
      taskId: string
      text: string
      bucket: string | null
      timeZone: string
    }) => {
      const date = localDateInTZ(timeZone)
      const { error } = await supabase.rpc('set_task_done', {
        p_date: date,
        p_task_id: taskId,
        p_text: text,
        p_bucket: bucket,
      })
      if (error) throw error
      return date
    },
    onSuccess: (date) => {
      qc.invalidateQueries({ queryKey: HISTORY_KEY })
      qc.invalidateQueries({ queryKey: ['daily_state', date] })
    },
  })
}

// Restore a task marked done today: calls set_task_undone, which flips today's
// done[id]=false and clears done_at[id]. History is PERMANENT and is NOT touched — so we
// only invalidate today's daily_state query, never the history query.
export function useRestoreTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ taskId, timeZone }: { taskId: string; timeZone: string }) => {
      const date = localDateInTZ(timeZone)
      const { error } = await supabase.rpc('set_task_undone', {
        p_date: date,
        p_task_id: taskId,
      })
      if (error) throw error
      return date
    },
    onSuccess: (date) => {
      qc.invalidateQueries({ queryKey: ['daily_state', date] })
    },
  })
}
