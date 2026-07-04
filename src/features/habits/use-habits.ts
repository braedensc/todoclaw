import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { localDateInTZ } from '../../lib/dates'
import { HabitSchema, type Habit } from '../../types/habit'
import type { DailyStateMaps } from '../daily-state/use-daily-state'

// The Daily Habits data layer. Mirrors src/features/tasks/use-tasks.ts:
//   - habits live in their own table; subtasks are an EMBEDDED jsonb array on the row
//     (no independent table — see src/types/habit.ts + the create_habits migration),
//   - the client never sends user_id (the DB default auth.uid() + RLS assign/enforce it),
//   - "delete" is a SOFT delete (deleted_at), there is no client hard-delete path.
//
// Per-day completion (which habits/steps are checked TODAY) does NOT live here — it lives in
// daily_state, written via the atomic merge RPC set_daily_flag (useToggleDailyFlag below) and
// read via useDailyState. That split is what makes the daily reset non-destructive: a new
// local day just reads a different (empty) daily_state row; the habit rows are untouched.

const HABITS_KEY = ['habits'] as const

// Fields a client may patch via useUpdateHabit. id/user_id/created_at are never client-set;
// deletes go through useSoftDeleteHabit. Covers the active toggle, text rename, and the
// subtasks array edits (add/remove a step).
type HabitPatch = Partial<Pick<Habit, 'text' | 'active' | 'subtasks'>>

// Fetch the signed-in user's LIVE habits, oldest-first (stable display order). RLS restricts
// rows to user_id = auth.uid(); we additionally filter out soft-deleted rows.
async function fetchHabits(): Promise<Habit[]> {
  const { data, error } = await supabase
    .from('habits')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) throw error
  return HabitSchema.array().parse(data)
}

export function useHabits() {
  return useQuery({ queryKey: HABITS_KEY, queryFn: fetchHabits })
}

// Insert a habit. user_id is NOT sent by the client — the DB default (auth.uid()) and RLS
// WITH CHECK assign and enforce ownership server-side. `active` (true) and `subtasks` ([])
// come from the migration's column defaults, so the client only supplies text.
export function useAddHabit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (text: string) => {
      const { error } = await supabase.from('habits').insert({ text })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: HABITS_KEY }),
  })
}

// Generic single-habit update — the shared write path for the active toggle (queued ⇄ active),
// text rename, and subtasks-array edits (add/remove a step). RLS scopes the row to the owner;
// the client never sets user_id.
export function useUpdateHabit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: HabitPatch }) => {
      const { error } = await supabase.from('habits').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: HABITS_KEY }),
  })
}

// "Delete" is a SOFT delete (sets deleted_at), mirroring tasks. There is no client path to a
// hard delete — the migration grants no DELETE and defines no DELETE policy by design.
export function useSoftDeleteHabit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('habits')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: HABITS_KEY }),
  })
}

// Toggle a habit's (or a step's) checked-for-today flag. Goes through set_daily_flag, the
// atomic server-side merge RPC over today's daily_state row — never a client read-modify-write
// of the jsonb map — so concurrent toggles to different keys both survive (no clobber race).
//
//   map  = 'habit_done'   → key is the habit id
//   map  = 'subtask_done' → key is the COMPOSITE "habitId:subtaskId"
//
// p_date is the USER's local calendar day (localDateInTZ), mirroring daily_state.date — never
// server-UTC.
//
// OPTIMISTIC: onMutate flips the cached daily_state map[key] IMMEDIATELY so the checkbox reflects
// the new state the instant you click — no wait for the RPC + refetch, which is what caused the
// visible check/uncheck flicker. onError rolls the snapshot back; onSettled invalidates today's
// daily_state (same date key the read hook uses) to reconcile with the server. The atomic
// server-side merge in set_daily_flag is preserved — we never client read-modify-write the jsonb.
type ToggleFlagVars = {
  map: 'habit_done' | 'subtask_done'
  key: string
  value: boolean
  timeZone: string
}

export function useToggleDailyFlag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ map, key, value, timeZone }: ToggleFlagVars) => {
      const date = localDateInTZ(timeZone)
      const { error } = await supabase.rpc('set_daily_flag', {
        p_date: date,
        p_map: map,
        p_key: key,
        p_value: value,
      })
      if (error) throw error
      return date
    },
    onMutate: async ({ map, key, value, timeZone }: ToggleFlagVars) => {
      const queryKey = ['daily_state', localDateInTZ(timeZone)] as const
      // Stop any in-flight refetch from clobbering the optimistic write.
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<DailyStateMaps>(queryKey)
      // Only patch when the day's row is already cached (the read hook populates it on mount);
      // otherwise leave it for the onSettled refetch rather than seed a partial shape.
      if (previous) {
        qc.setQueryData<DailyStateMaps>(queryKey, {
          ...previous,
          [map]: { ...previous[map], [key]: value },
        })
      }
      return { queryKey, previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(context.queryKey, context.previous)
    },
    onSettled: (_date, _err, _vars, context) => {
      if (context) qc.invalidateQueries({ queryKey: context.queryKey })
    },
  })
}
