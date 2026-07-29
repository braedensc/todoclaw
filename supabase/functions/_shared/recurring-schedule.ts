// Scheduling the NEXT occurrence of a recurring chore onto a chosen day.
//
// The user's ask is "I need to do X on <day>" — the chore must be on the board and in that day's
// Plan My Day. A recurring chore's due-ness is derived, not stored: `recurringStatus` computes
// `daysLeft = frequencyDays - daysSince(lastDoneAt)`, and every surface (grid `isPlaced`,
// MobileMatrix, the list badge, both `buildPlanRequest` twins, BabyClaw's chat context) reads
// that one function. So the way to put a chore on a given day is to PHASE its cadence clock:
// choose the `lastDoneAt` whose cycle lands on that day.
//
// Deliberately NOT a new column. `tasks.due` is already taken — it is the reminder recurrence
// ANCHOR (`next_recurring_fire_at` phases the occurrence grid off `due` + `due_time` and never
// advances it), so it cannot double as a deadline. And a new column would have to be threaded
// through every reader above, adding a cross-tree invariant to keep in lockstep. Phasing needs
// ZERO reader changes: every surface already knows how to render and plan a chore that is due.

import { startOfLocalDayInstant } from './dates.ts'

const MS_PER_DAY = 86_400_000

/**
 * The `lastDoneAt` that makes a `frequencyDays` chore read as DUE on the wall-clock day `date`
 * in `timeZone` — local midnight of `date`, minus one full cycle.
 *
 * Why this lands exactly right, given `daysSince = floor((now - lastDoneAt) / MS_PER_DAY)`:
 * - at local midnight of `date` the elapsed time is exactly `frequencyDays` days, so
 *   `daysLeft === 0` → "due today";
 * - anywhere later in that day elapsed stays under one more day (or ticks to `-1` on a 25-hour
 *   DST day), and `statusFromDaysLeft` reads both `0` and `-1` as "due today";
 * - on the day BEFORE, elapsed is short of a full cycle, so `daysLeft === 1` → "due tomorrow",
 *   which is code `due` — it is already visible on the board and in the plan as a heads-up.
 *
 * DST-safe by construction: both ends are absolute instants and the offset is a fixed duration,
 * so no calendar arithmetic is involved. Scheduling for TODAY is the same operation with
 * `date` = today, which is exactly the cycle rewind `restore_task` performs.
 */
export function lastDoneAtForOccurrenceOn(
  date: string,
  frequencyDays: number,
  timeZone: string,
): string {
  const freq = Math.max(Math.trunc(frequencyDays) || 1, 1)
  const dayStart = startOfLocalDayInstant(date, timeZone)
  return new Date(dayStart.getTime() - freq * MS_PER_DAY).toISOString()
}
