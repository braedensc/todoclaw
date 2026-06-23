import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { TaskSchema, type Task } from '../../types/task'

const TASKS_KEY = ['tasks'] as const

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

// Insert a task. user_id is NOT sent by the client — the DB default (auth.uid())
// and RLS WITH CHECK assign and enforce ownership server-side.
export function useAddTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (text: string) => {
      const { error } = await supabase.from('tasks').insert({ text })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  })
}

// "Delete" is a SOFT delete (sets deleted_at). There is no client path to a hard
// delete — the migration grants no DELETE and defines no DELETE policy by design.
export function useSoftDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tasks')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  })
}
