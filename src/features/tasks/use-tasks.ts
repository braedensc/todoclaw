import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/use-toast'
import { TaskSchema, type Recurring, type Task } from '../../types/task'

const TASKS_KEY = ['tasks'] as const

// Fields a client may patch via useUpdateTask. id/user_id/created_at are never client-set;
// deletes go through useSoftDeleteTask. This covers every later-feature write: grid x/y,
// text, due date + time, staged, recurring, and the ongoing-project flag.
type TaskPatch = Partial<
  Pick<Task, 'text' | 'x' | 'y' | 'due' | 'due_time' | 'staged' | 'recurring' | 'ongoing'>
>

// Fetch the signed-in user's LIVE tasks. RLS restricts rows to user_id = auth.uid();
// we additionally filter out soft-deleted rows (deleted_at is not null).
async function fetchTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return TaskSchema.array().parse(data)
}

export function useTasks() {
  return useQuery({ queryKey: TASKS_KEY, queryFn: fetchTasks })
}

// What can be set at creation time: the text plus optional due date and recurring cadence (B8 —
// the Manual widget's Due/Repeat controls), plus optional placement (x/y + staged) for the mobile
// create-into-quadrant flow, which inserts an already-PLACED task instead of a staged one. A bare
// string is still accepted for the common "just a title" case.
export type NewTask =
  | string
  | {
      text: string
      due?: string | null
      due_time?: string | null
      recurring?: Recurring | null
      ongoing?: boolean
      x?: number
      y?: number
      staged?: boolean
    }

// Insert a task. user_id is NOT sent by the client — the DB default (auth.uid())
// and RLS WITH CHECK assign and enforce ownership server-side.
//
// x/y seed at 0.5 (grid center) unless the caller places the task, matching EisenClaw: new tasks
// default staged:true (DB default) but must have non-null x/y or the priority score computes NaN
// downstream. Create-into-quadrant passes x/y + staged:false to insert a placed task directly.
// Every task mutation attaches an onError that surfaces a toast (via useToast). These writes had NO
// error path — a failed PATCH/INSERT (a dropped connection, a schema drift like PR #240's missing
// column) resolved silently, so the change just "didn't happen" with no signal. No consumer wires
// its own onError, so the guard lives here at the shared write path: a failed write can never again
// look like a no-op, wherever it was triggered from (grid drag, list slider, cluster popup, add).
export function useAddTask() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (input: NewTask) => {
      const parsed: {
        text: string
        due?: string | null
        due_time?: string | null
        recurring?: Recurring | null
        ongoing?: boolean
        x?: number
        y?: number
        staged?: boolean
      } = typeof input === 'string' ? { text: input } : input
      const {
        text,
        due = null,
        due_time = null,
        recurring = null,
        ongoing = false,
        x = 0.5,
        y = 0.5,
        staged,
      } = parsed
      const { data, error } = await supabase
        .from('tasks')
        // `staged` is omitted unless provided, so it keeps its DB default (true) for the widget's
        // staged-then-place flow; create-into-quadrant sends staged:false for a placed task.
        .insert({
          text,
          x,
          y,
          due,
          due_time,
          recurring,
          ongoing,
          ...(staged === undefined ? {} : { staged }),
        })
        // Return the created row so a caller can chain (e.g. attach a due-time reminder — PR 5).
        .select('*')
        .single()
      if (error) throw error
      return TaskSchema.parse(data)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
    onError: () => toast("Couldn't add that task — try again.", 'error'),
  })
}

// Generic single-task update — the shared write path for x/y, text, due, staged, recurring
// used by every later feature PR (grid drag, list sliders, inline edit). RLS scopes the
// row to the owner; the client never sets user_id.
export function useUpdateTask() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TaskPatch }) => {
      const { error } = await supabase.from('tasks').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
    onError: () => toast("Couldn't save your change — try again.", 'error'),
  })
}

// "Delete" is a SOFT delete (sets deleted_at). There is no client path to a hard
// delete — the migration grants no DELETE and defines no DELETE policy by design.
export function useSoftDeleteTask() {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tasks')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
    onError: () => toast("Couldn't delete that task — try again.", 'error'),
  })
}
