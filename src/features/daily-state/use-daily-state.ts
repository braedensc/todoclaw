import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { localDateInTZ } from '../../lib/dates'
import { DailyStateSchema, type DailyState } from '../../types/daily-state'

// Today's per-user daily state: the maps of what's been completed today. The row is keyed
// by the user's LOCAL calendar day (never server UTC) so the daily reset is non-destructive
// — crossing local midnight just refetches a different date's row (which won't exist yet).
//
// Read-only here. The row is created LAZILY by the first mark-done (a mutation added in a
// later PR), so "no row" is the normal empty state, NOT an error: we return empty maps.

const EMPTY_DAILY_STATE = {
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
  const { data, error } = await supabase
    .from('daily_state')
    .select('*')
    .eq('date', today)
    .maybeSingle()

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
  const today = localDateInTZ(timeZone)
  // Date-keyed so the query naturally refetches a new (empty) day when local midnight passes.
  return useQuery({
    queryKey: ['daily_state', today],
    queryFn: () => fetchDailyState(today),
  })
}
