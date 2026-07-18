import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/use-toast'

// Client access to task_reminders (ADR 2026-07-09; multi-reminder 2026-07-11; recurring unified
// 2026-07-12). A task — one-off OR recurring — can hold SEVERAL reminders at different lead times,
// so the query returns the sorted list of offsets per task and the write helpers add/remove ONE
// offset at a time (or clear them all). A recurring task's reminders lead each occurrence; a
// one-off's lead the single due instant — same rows, same offset model, the fire-time formula is
// the only difference and it lives server-side.
//
// Writes go through the SECURITY INVOKER RPCs set_task_reminder / remove_task_reminder /
// clear_task_reminder — NOT a direct PostgREST upsert — so the SQL reminder_fire_at() /
// next_recurring_fire_at() helpers are the SOLE place fire_at is ever computed (the earlier
// client-side TS computation disagreed with Postgres AT TIME ZONE by an hour inside DST windows
// west of UTC; PR 6 review). The RPCs run under the caller's JWT, so RLS scopes every write to the
// caller's own task + reminder. Reads stay a plain RLS-scoped select.

const REMINDERS_KEY = ['task_reminders'] as const

interface TaskReminderRow {
  task_id: string
  offset_minutes: number
}

// A map task_id → sorted offsets so an editor can look up its task's current reminders in O(1).
// Every row carries an offset now (the kind is the task's, not the row's).
async function fetchTaskReminders(): Promise<Map<string, number[]>> {
  const { data, error } = await supabase.from('task_reminders').select('task_id, offset_minutes')
  if (error) throw error
  const map = new Map<string, number[]>()
  for (const r of (data ?? []) as TaskReminderRow[]) {
    const list = map.get(r.task_id)
    if (list) list.push(r.offset_minutes)
    else map.set(r.task_id, [r.offset_minutes])
  }
  for (const list of map.values()) list.sort((a, b) => a - b)
  return map
}

export function useTaskReminders() {
  return useQuery({ queryKey: REMINDERS_KEY, queryFn: fetchTaskReminders })
}

// Add/remove/clear a task's reminders. Each write invalidates the shared query so every surface
// re-reads the new set. The task must already have a due date + time — set_task_reminder enforces
// that and raises otherwise (the picker only shows once a due time exists, so this is a backstop).
// Recurring tasks are allowed (the RPC picks the occurrence-anchored fire time). No timezone/fire_at
// is passed — the RPC reads user_schedule.timezone itself.
export function useTaskReminderWrites() {
  const qc = useQueryClient()
  const toast = useToast()
  const onSuccess = () => qc.invalidateQueries({ queryKey: REMINDERS_KEY })
  // These writes fire imperatively from the picker (mutate, not awaited), so a failure has no return
  // path — without this the reminder silently doesn't arm and the user believes it's set.
  const onError = () => toast("Couldn't update that reminder — try again.", 'error')

  const addM = useMutation({
    mutationFn: async ({ taskId, offsetMinutes }: { taskId: string; offsetMinutes: number }) => {
      const { error } = await supabase.rpc('set_task_reminder', {
        p_task_id: taskId,
        p_offset_minutes: offsetMinutes,
      })
      if (error) throw error
    },
    onSuccess,
    onError,
  })
  const removeM = useMutation({
    mutationFn: async ({ taskId, offsetMinutes }: { taskId: string; offsetMinutes: number }) => {
      const { error } = await supabase.rpc('remove_task_reminder', {
        p_task_id: taskId,
        p_offset_minutes: offsetMinutes,
      })
      if (error) throw error
    },
    onSuccess,
    onError,
  })
  const clearM = useMutation({
    mutationFn: async ({ taskId }: { taskId: string }) => {
      const { error } = await supabase.rpc('clear_task_reminder', { p_task_id: taskId })
      if (error) throw error
    },
    onSuccess,
    onError,
  })

  return {
    /** Add (or re-arm) one lead time. */
    add: (taskId: string, offsetMinutes: number) => addM.mutate({ taskId, offsetMinutes }),
    /** Remove one lead time. */
    remove: (taskId: string, offsetMinutes: number) => removeM.mutate({ taskId, offsetMinutes }),
    /** Remove every reminder on the task (the picker's Off chip). */
    clear: (taskId: string) => clearM.mutate({ taskId }),
    /** Flip one lead time on/off given the task's current set. */
    toggle: (taskId: string, offsetMinutes: number, current: readonly number[]) =>
      current.includes(offsetMinutes)
        ? removeM.mutate({ taskId, offsetMinutes })
        : addM.mutate({ taskId, offsetMinutes }),
  }
}
