import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { UserScheduleSchema, type UserSchedule } from '../../types/user-schedule'

const SCHEDULE_KEY = ['user_schedule'] as const

// There is at most one user_schedule row per user (RLS scopes to auth.uid()).
// Returns null when no row exists yet — useEnsureUserSchedule() creates it.
async function fetchUserSchedule(): Promise<UserSchedule | null> {
  const { data, error } = await supabase.from('user_schedule').select('*').maybeSingle()

  if (error) throw error
  return data ? UserScheduleSchema.parse(data) : null
}

export function useUserSchedule() {
  return useQuery({ queryKey: SCHEDULE_KEY, queryFn: fetchUserSchedule })
}

// On first authenticated load, guarantee a user_schedule row exists. The daily reset
// depends on `timezone`, so the row must always be present. We seed it from the browser's
// resolved IANA zone and an empty config (the Plan My Day stage fills config in later).
//
// user_id is NOT sent by the client — the column defaults to auth.uid() and RLS WITH CHECK
// enforces ownership server-side. upsert with onConflict 'user_id' is idempotent: a row that
// already exists is left as-is on the seeded timezone, so re-running this never clobbers a
// timezone the user has since changed (ignoreDuplicates).
export function useEnsureUserSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const { error } = await supabase
        .from('user_schedule')
        .upsert({ timezone, config: {} }, { onConflict: 'user_id', ignoreDuplicates: true })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SCHEDULE_KEY }),
  })
}
