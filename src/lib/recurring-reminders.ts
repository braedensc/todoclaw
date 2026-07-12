// Recurring-reminder fire-time math. A recurring reminder is now the SAME offset model as a one-off
// reminder — a chosen lead time before the task's next occurrence — only the occurrence repeats on
// the task's cadence (unify 2026-07-12). The occurrence grid is phased off the task's DUE date at
// its DUE time (the anchor); a reminder fires `offsetMinutes` before the next occurrence that is
// still in the future, and re-arms to the following one each cycle (fixed cadence, independent of
// completion — the pill-before-noon case). This is the TS mirror of the SQL next_recurring_fire_at()
// helper (supabase/migrations/*_recurring_reminders_unify.sql). The SQL remains the SOLE production
// writer of task_reminders.fire_at — the same split as dueInstant() (client display) vs
// reminder_fire_at() (SQL) — so this exists for client reasoning/tests, not to compute the stored
// instant.

import { dueInstant } from './dates'

// A generous backstop against a pathological anchor (never reached for realistic cadences/outages:
// a daily reminder anchored ~270 years ago would still converge inside this).
const MAX_ITER = 100_000

/** ISO 'YYYY-MM-DD' + integer days, done in UTC-noon so it is pure calendar math (no tz/DST drift —
 *  we never project to a local instant here; that is dueInstant's job below). */
function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The next instant a recurring reminder fires: `offsetMinutes` before the least occurrence of the
 * task on its cadence grid — every `freqDays`, phased off the anchor `due` date at wall-clock
 * `dueTime` in `timeZone` — whose lead time is still strictly after `now`.
 *
 * - Initial arm: k=0 is the anchor occurrence (`due` itself); the loop rolls forward until an
 *   occurrence's `(occurrence − offset)` lands after `now`, so a lead time that has already elapsed
 *   arms the NEXT occurrence instead of firing late.
 * - Advance on fire: called again after a fire (fire ≤ now); it returns the following slot.
 *
 * DST-correct: it advances the wall-clock DATE (calendar-safe integer-day math) and re-projects
 * each candidate occurrence through `dueInstant` (AT TIME ZONE), so the occurrence holds the same
 * LOCAL time across a DST change (the instant shifts by the offset delta, the clock reading does
 * not). And it jumps straight past a whole backlog, so a cron outage spanning several cycles yields
 * the single next future slot — the reminder fires ONCE, not once per missed cycle.
 */
export function nextRecurringFireAt(
  due: string,
  dueTime: string,
  freqDays: number,
  offsetMinutes: number,
  timeZone: string,
  now: Date,
): Date {
  const freq = Math.max(Math.trunc(freqDays) || 1, 1)
  const offsetMs = Math.max(Math.trunc(offsetMinutes) || 0, 0) * 60_000
  let fire = new Date(0)
  for (let k = 0; k < MAX_ITER; k++) {
    const occurrence = dueInstant(addDaysISO(due, k * freq), dueTime, timeZone)
    fire = new Date(occurrence.getTime() - offsetMs)
    if (fire.getTime() > now.getTime()) return fire
  }
  return fire
}
