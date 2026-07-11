// Recurring-reminder fire-time math. A recurring reminder is a FIXED-CADENCE ALARM: it fires at a
// wall-clock time of day on the task's cadence, every cycle, regardless of completion (the
// pill-at-noon case). This is the TS mirror of the SQL next_recurring_fire_at() helper
// (supabase/migrations/*_recurring_reminders.sql). The SQL remains the SOLE production writer of
// task_reminders.fire_at — the same split as dueInstant() (client display) vs reminder_fire_at()
// (SQL) — so this exists for client reasoning/tests, not to compute the stored instant.

import { dueInstant, localDateInTZ } from './dates'

// A generous backstop against a pathological seed (never reached for realistic cadences/outages:
// a daily reminder seeded ~270 years ago would still converge inside this).
const MAX_ITER = 100_000

/** ISO 'YYYY-MM-DD' + integer days, done in UTC-noon so it is pure calendar math (no tz/DST drift —
 *  we never project to a local instant here; that is dueInstant's job below). */
function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The next instant a recurring fixed-cadence reminder fires: the least occurrence of wall-clock
 * `timeOfDay` on the cadence grid — every `freqDays`, phased off the seed's local date in
 * `timeZone` — that is strictly after `now`.
 *
 * - Initial arm: pass a seed of "today at the time" (its local date phases the grid); k=0 succeeds
 *   when today's slot is still ahead, else it rolls to the next cadence day.
 * - Advance on fire: pass the just-fired `fire_at` (which is ≤ now); the loop returns the next slot.
 *
 * DST-correct: it advances the wall-clock DATE (calendar-safe integer-day math) and re-projects
 * each candidate through `dueInstant` (AT TIME ZONE), so the fire holds the same LOCAL time across a
 * DST change (the instant shifts by the offset delta, the clock reading does not). And it jumps
 * straight past a whole backlog, so a cron outage spanning several cycles yields the single next
 * future slot — the reminder fires ONCE, not once per missed cycle.
 */
export function nextRecurringFireAt(
  seed: Date,
  timeOfDay: string,
  freqDays: number,
  timeZone: string,
  now: Date,
): Date {
  const freq = Math.max(Math.trunc(freqDays) || 1, 1)
  const baseDate = localDateInTZ(timeZone, seed)
  let fire = dueInstant(baseDate, timeOfDay, timeZone)
  for (let k = 0; k < MAX_ITER; k++) {
    fire = dueInstant(addDaysISO(baseDate, k * freq), timeOfDay, timeZone)
    if (fire.getTime() > now.getTime()) return fire
  }
  return fire
}
