import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { reminderFireAt } from '../../lib/dates'
import type { Task } from '../../types/task'

// Client access to task_reminders (ADR 2026-07-09). The backend owns fire_at's LIFECYCLE — the
// due/timezone triggers recompute it — but a client-created reminder must materialize the FIRST
// fire_at itself (no trigger fires on a task_reminders insert), so the same wall-clock math
// (reminderFireAt → dueInstant) runs here. RLS + the user_id column default scope every row to
// the caller; onConflict(task_id) makes the write idempotent + editable (v1 = one per task).

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

// Set or clear a task's reminder. `offsetMinutes` null → delete the row; a number → upsert with a
// freshly materialized fire_at and sent_at reset to null (re-arm). The caller guarantees the task
// has both due + due_time (the picker only shows once a time exists); a missing one throws rather
// than silently writing a bad instant.
export function useUpsertTaskReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      task,
      offsetMinutes,
      timeZone,
    }: {
      task: Pick<Task, 'id' | 'due' | 'due_time'>
      offsetMinutes: number | null
      timeZone: string
    }) => {
      if (offsetMinutes === null) {
        const { error } = await supabase.from('task_reminders').delete().eq('task_id', task.id)
        if (error) throw error
        return
      }
      if (!task.due || !task.due_time) {
        throw new Error('a task reminder requires a due date and time')
      }
      const fire_at = reminderFireAt(task.due, task.due_time, offsetMinutes, timeZone).toISOString()
      // user_id is omitted — the column default (auth.uid()) + RLS WITH CHECK assign and enforce
      // ownership; onConflict(task_id) turns a re-set into an in-place edit (user_id untouched).
      const { error } = await supabase
        .from('task_reminders')
        .upsert(
          { task_id: task.id, offset_minutes: offsetMinutes, fire_at, sent_at: null },
          { onConflict: 'task_id' },
        )
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: REMINDERS_KEY }),
  })
}
