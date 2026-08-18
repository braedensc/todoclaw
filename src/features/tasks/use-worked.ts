import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/use-toast'
import { localDateInTZ } from '../../lib/dates'
import type { Task } from '../../types/task'

// Log (or un-log) a work SESSION on an ongoing project — the everyday ✓ for that task type.
//
// Writes through the log_task_work RPC rather than a direct column patch: the merge (prepend +
// de-duplicate + cap) has to happen server-side under a row lock, or two devices logging the same
// morning would clobber one another. The RPC returns the new array, so this is also the only task
// write that gets its result back rather than re-reading.
//
// Unlike useUpdateTask (deliberately non-optimistic) this one IS optimistic. Tapping ✓ is the
// highest-frequency gesture in the app and the card does not move or disappear when a session is
// logged — the only feedback is the button's own filled state, so a round-trip of lag reads as
// "the tap didn't register" and invites a double-tap. The write is idempotent per day, so even a
// double-tap that races cannot corrupt the log.

const TASKS_KEY = ['tasks'] as const

export function useLogWork() {
  const qc = useQueryClient()
  const toast = useToast()

  return useMutation({
    mutationFn: async ({
      taskId,
      timeZone,
      logged = true,
    }: {
      taskId: string
      timeZone: string
      /** false un-logs today's session (the ✓ acting as a toggle). */
      logged?: boolean
    }) => {
      const { data, error } = await supabase.rpc('log_task_work', {
        p_task_id: taskId,
        p_local_date: localDateInTZ(timeZone),
        p_logged: logged,
      })
      if (error) throw error
      return data as string[] | null
    },

    // Paint the new state immediately, and hand back a rollback snapshot.
    onMutate: async ({ taskId, timeZone, logged = true }) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY })
      const previous = qc.getQueryData<Task[]>(TASKS_KEY)
      const today = localDateInTZ(timeZone)

      qc.setQueryData<Task[]>(TASKS_KEY, (tasks) =>
        tasks?.map((t) => {
          if (t.id !== taskId) return t
          const days = t.worked_days ?? []
          return {
            ...t,
            worked_days: logged
              ? days.includes(today)
                ? days // already logged today — the RPC is a no-op, so don't fake a change
                : [today, ...days]
              : days.filter((d) => d !== today),
          }
        }),
      )

      return { previous }
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(TASKS_KEY, context.previous)
      toast("Couldn't log that session — try again.", 'error')
    },

    // Reconcile against the server's authoritative array (it applies the cap and the de-dupe, and
    // may differ from the optimistic guess when another device logged the same day).
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TASKS_KEY })
    },
  })
}
