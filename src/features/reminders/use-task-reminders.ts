import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// Client access to task_reminders (ADR 2026-07-09; multi-reminder 2026-07-11). A task can hold
// SEVERAL reminders at different lead times, so the query returns the sorted list of offsets per
// task and the write helpers add/remove ONE offset at a time (or clear them all).
//
// Writes go through the SECURITY INVOKER RPCs set_task_reminder / remove_task_reminder /
// clear_task_reminder — NOT a direct PostgREST upsert — so the SQL reminder_fire_at() helper is
// the SOLE place fire_at is ever computed (the earlier client-side TS computation disagreed with
// Postgres AT TIME ZONE by an hour inside DST windows west of UTC; PR 6 review). The RPCs run
// under the caller's JWT, so RLS scopes every write to the caller's own task + reminder. Reads
// stay a plain RLS-scoped select.

const REMINDERS_KEY = ['task_reminders'] as const
// A sub-key under REMINDERS_KEY so invalidating the prefix (['task_reminders']) refetches BOTH the
// one-off offsets query and the recurring time-of-day query with a single invalidation.
const RECURRING_REMINDERS_KEY = ['task_reminders', 'recurring'] as const

interface TaskReminderRow {
  task_id: string
  offset_minutes: number
}

// A map task_id → sorted offsets so an editor can look up its task's current reminders in O(1).
// Only ONE-OFF rows carry an offset; recurring (time-of-day) rows are read separately below.
async function fetchTaskReminders(): Promise<Map<string, number[]>> {
  const { data, error } = await supabase
    .from('task_reminders')
    .select('task_id, offset_minutes')
    .not('offset_minutes', 'is', null)
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

interface RecurringReminderRow {
  task_id: string
  time_of_day: string
}

// A map task_id → wall-clock 'HH:MM:SS' for the single recurring reminder a task may hold (a
// fixed-cadence alarm). Only rows with a time_of_day (the recurring kind) are read.
async function fetchRecurringReminders(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('task_reminders')
    .select('task_id, time_of_day')
    .not('time_of_day', 'is', null)
  if (error) throw error
  const map = new Map<string, string>()
  for (const r of (data ?? []) as RecurringReminderRow[]) map.set(r.task_id, r.time_of_day)
  return map
}

export function useRecurringReminder() {
  return useQuery({ queryKey: RECURRING_REMINDERS_KEY, queryFn: fetchRecurringReminders })
}

// Add/remove/clear a task's reminders. Each write invalidates the shared query so every surface
// re-reads the new set. The task must already have a due date + time and not be recurring —
// set_task_reminder enforces that and raises otherwise (the picker only shows once a due time
// exists and is hidden for recurring tasks, so this is a backstop). No timezone/fire_at is
// passed — the RPC reads user_schedule.timezone itself.
export function useTaskReminderWrites() {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: REMINDERS_KEY })

  const addM = useMutation({
    mutationFn: async ({ taskId, offsetMinutes }: { taskId: string; offsetMinutes: number }) => {
      const { error } = await supabase.rpc('set_task_reminder', {
        p_task_id: taskId,
        p_offset_minutes: offsetMinutes,
      })
      if (error) throw error
    },
    onSuccess,
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
  })
  const clearM = useMutation({
    mutationFn: async ({ taskId }: { taskId: string }) => {
      const { error } = await supabase.rpc('clear_task_reminder', { p_task_id: taskId })
      if (error) throw error
    },
    onSuccess,
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

// Set/remove a RECURRING task's single time-of-day reminder (a fixed-cadence alarm). Writes route
// through the SECURITY INVOKER RPCs set_recurring_reminder / remove_recurring_reminder — the SQL
// next_recurring_fire_at() helper is the sole writer of fire_at (never a direct upsert). Each write
// invalidates the shared ['task_reminders'] prefix so both reminder queries re-read. The RPC reads
// the task's cadence + the user's timezone itself; the caller passes only the wall-clock time.
export function useRecurringReminderWrites() {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: REMINDERS_KEY })

  const setM = useMutation({
    mutationFn: async ({ taskId, time }: { taskId: string; time: string }) => {
      const { error } = await supabase.rpc('set_recurring_reminder', {
        p_task_id: taskId,
        p_time_of_day: time,
      })
      if (error) throw error
    },
    onSuccess,
  })
  const removeM = useMutation({
    mutationFn: async ({ taskId }: { taskId: string }) => {
      const { error } = await supabase.rpc('remove_recurring_reminder', { p_task_id: taskId })
      if (error) throw error
    },
    onSuccess,
  })

  return {
    /** Set (or replace) the task's recurring reminder at a wall-clock 'HH:MM' time. */
    set: (taskId: string, time: string) => setM.mutate({ taskId, time }),
    /** Remove the task's recurring reminder (the Off chip). */
    remove: (taskId: string) => removeM.mutate({ taskId }),
  }
}
