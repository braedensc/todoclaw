import { useUserSchedule } from './use-user-schedule'

// The browser's IANA zone. This is the ONLY correct fallback while the user_schedule row is
// loading: useEnsureUserSchedule seeds the row's timezone from exactly this value, so the
// fallback and the eventually-loaded row agree and "today" never flips mid-session. (Views
// previously chose their own fallbacks — grid used the browser zone while list/done/habits
// used 'UTC' — so a task marked done on the grid could briefly key a DIFFERENT daily_state
// date than the Done tab read whenever local date ≠ UTC date, e.g. US evenings.)
const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

/**
 * The user's timezone for all "today" computations (daily_state keys, daysUntil, recurring
 * status). The stored `user_schedule.timezone` is authoritative once loaded; until then the
 * browser zone stands in. Every view MUST use this hook rather than picking its own fallback.
 */
export function useTimeZone(): string {
  const { data: schedule } = useUserSchedule()
  return schedule?.timezone ?? BROWSER_TZ
}
