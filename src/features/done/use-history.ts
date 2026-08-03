import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/use-toast'
import { localDateInTZ } from '../../lib/dates'
import { HistorySchema, type History } from '../../types/history'

// The Done tab's data layer. The completion log (history) plus the daily_state mutations
// behind it (mark a task done / restore it) and a direct delete of a history row. The
// done/undone writes go through the server-side merge RPCs from the migration, never a
// client read-modify-write, so the per-day jsonb maps are updated atomically (no clobber
// race).

const HISTORY_KEY = ['history'] as const

// Fetch the signed-in user's completion log, newest-first. RLS restricts rows to
// user_id = auth.uid(). Rows are hard-deleted (not soft-deleted) from the Done tab, so
// there is no deleted column to filter — a removed completion is simply gone.
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
// Invalidates the history query, today's daily_state query (same date key the read hook uses),
// AND the tasks query — set_task_done now stamps tasks.completed_at, so the task must refetch to
// leave the grid/list/mobile (its permanent, across-day hide).
export function useMarkTaskDone() {
  const qc = useQueryClient()
  const toast = useToast()
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
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    // Checking a task off is the highest-frequency write; a silent failure is the "tick does
    // nothing" symptom. Surface it so the user knows to retry instead of assuming it stuck.
    onError: () => toast("Couldn't mark that done — try again.", 'error'),
  })
}

// Restore a completed task: calls set_task_undone, which clears the task's permanent
// completed_at AND flips TODAY's done[id]=false / clears done_at[id] — un-completing it so it
// returns to the grid at its stored x/y. Since completed_at is the load-bearing across-day hide,
// we invalidate BOTH today's daily_state query and the tasks query. The history row is NOT
// touched by restore (delete is a separate action).
export function useRestoreTask() {
  const qc = useQueryClient()
  const toast = useToast()
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
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: () => toast("Couldn't restore that task — try again.", 'error'),
  })
}

// Remove a single completion RECORD from the history log (the Done tab's ✕). Deletes the
// history row by id; RLS (history_delete_own, added in 20260705000000_history_delete_policy)
// scopes the delete to the owner, so a caller can only remove their own rows. This does NOT
// touch the task — the task stays live (deleting the record just clears the log entry).
// Invalidates only the history query.
export function useDeleteHistoryEntry() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('history').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: HISTORY_KEY })
    },
    onError: () => toast("Couldn't remove that entry — try again.", 'error'),
  })
}
