import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useLocalToday } from '../../hooks/use-local-today'
import { DailyStateSchema, type DailyState } from '../../types/daily-state'

// Today's per-user daily state: the maps of what's been completed today. The row is keyed
// by the user's LOCAL calendar day (never server UTC) so the daily reset is non-destructive
// — crossing local midnight just refetches a different date's row (which won't exist yet).
//
// Read-only here. The row is created LAZILY by the first mark-done (a mutation added in a
// later PR), so "no row" is the normal empty state, NOT an error: we return empty maps.

// The canonical "nothing recorded today" maps. Exported so an optimistic writer (e.g.
// useToggleDailyFlag) can seed a correctly-shaped row when the read query hasn't populated
// the cache yet — never a partial shape.
export const EMPTY_DAILY_STATE = {
  done: {},
  done_at: {},
  habit_done: {},
  subtask_done: {},
  plan: null,
} as const

export type DailyStateMaps = Pick<
  DailyState,
  'done' | 'done_at' | 'habit_done' | 'subtask_done'
> & { plan: DailyState['plan'] }

async function fetchDailyState(today: string): Promise<DailyStateMaps> {
  // plan is encrypted at rest; daily_state_get (DEFINER, fenced to auth.uid()) returns the completion
  // maps plus the DECRYPTED plan as one row (or null when today has no row yet → empty state).
  const { data, error } = await supabase.rpc('daily_state_get', { p_date: today })

  if (error) throw error
  if (!data) return EMPTY_DAILY_STATE

  const parsed = DailyStateSchema.parse(data)
  return {
    done: parsed.done,
    done_at: parsed.done_at,
    habit_done: parsed.habit_done,
    subtask_done: parsed.subtask_done,
    // Today's persisted plan (the inline plan card hydrates from this on load); null when unset.
    plan: parsed.plan ?? null,
  }
}

export function useDailyState(timeZone: string) {
  // LIVE local date (useLocalToday): the key flips on its own at local midnight / on app
  // foreground, so an app left open overnight rolls to the new (empty) day — habits and the done
  // map visibly reset each morning without waiting for the user's first interaction.
  const today = useLocalToday(timeZone)
  return useQuery({
    queryKey: ['daily_state', today],
    queryFn: () => fetchDailyState(today),
  })
}
