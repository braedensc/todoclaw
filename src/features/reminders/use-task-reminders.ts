import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// Client access to task_reminders (ADR 2026-07-09). Writes go through the SECURITY INVOKER RPCs
// set_task_reminder / clear_task_reminder — NOT a direct PostgREST upsert — so the SQL
// reminder_fire_at() helper is the SOLE place fire_at is ever computed (the earlier client-side TS
// computation disagreed with Postgres AT TIME ZONE by an hour inside DST windows west of UTC; PR 6
// review). The RPCs run under the caller's JWT, so RLS scopes every write to the caller's own
// task + reminder exactly as the old upsert did. Reads stay a plain RLS-scoped select.

const REMINDERS_KEY = ['task_reminders'] as const

export interface TaskReminder {
  task_id: string
  offset_minutes: number
  sent_at: string | null
}

// A map task_id → reminder so an editor can look up its task's current offset in O(1).
async function fetchTaskReminders(): Promise<Map<string, TaskReminder>> {
  const { data, error } = await supabase
    .from('task_reminders')
    .select('task_id, offset_minutes, sent_at')
  if (error) throw error
  const map = new Map<string, TaskReminder>()
  for (const r of (data ?? []) as TaskReminder[]) map.set(r.task_id, r)
  return map
}

export function useTaskReminders() {
  return useQuery({ queryKey: REMINDERS_KEY, queryFn: fetchTaskReminders })
}

// Set or clear a task's reminder. `offsetMinutes` null → clear_task_reminder (delete); a number →
// set_task_reminder (upsert, computing fire_at server-side + re-arming). The task must already have
// a due date + time and not be recurring — set_task_reminder enforces that and raises otherwise
// (the picker only shows once a due time exists and is hidden for recurring tasks, so this is a
// backstop). No timezone/fire_at is passed — the RPC reads user_schedule.timezone itself.
export function useUpsertTaskReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      taskId,
      offsetMinutes,
    }: {
      taskId: string
      offsetMinutes: number | null
    }) => {
      const { error } =
        offsetMinutes === null
          ? await supabase.rpc('clear_task_reminder', { p_task_id: taskId })
          : await supabase.rpc('set_task_reminder', {
              p_task_id: taskId,
              p_offset_minutes: offsetMinutes,
            })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: REMINDERS_KEY }),
  })
}
