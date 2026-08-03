// Start-date (pause) helpers. A task with a FUTURE start_date is DORMANT: hidden from every
// render surface (grid placed + staged cards, list, mobile matrix), excluded from Plan My Day,
// and its reminders are suppressed server-side — until the user's local calendar reaches the
// date, when it wakes by itself at its stored x/y. "Pause until Aug 1" and "start this on Aug 1"
// are the same mechanism: one nullable wall-clock date column (tasks.start_date, same floating
// 'YYYY-MM-DD' model as `due` — ADR 2026-07-08-due-dates-wall-clock).
//
// This predicate is the client half of the rule; the SQL gates (due_task_reminders,
// dispatch_inputs_for_user) and the edge twin (_shared plan-inputs / chat-context) compare the
// same way: start_date > today-in-the-user's-zone. Keep them in step.

import { localDateInTZ } from './dates'

/**
 * True while the task's start date is still in the future for the user (start_date strictly
 * after today in `timeZone`). ISO 'YYYY-MM-DD' strings compare correctly as strings, so this is
 * pure calendar comparison — no instants, no DST edge. A null/absent or past/today start date
 * means the task is live.
 */
export function isDormant(
  task: { start_date?: string | null },
  timeZone: string,
  now: Date = new Date(),
): boolean {
  const start = task.start_date
  if (!start) return false
  return start.slice(0, 10) > localDateInTZ(timeZone, now)
}

/**
 * Human day for a start date — "Aug 1" (host locale). Pure UTC-noon date math like the
 * SchedulePanel calendar cells: the string already IS the user's wall-clock day, so projecting
 * it through a timezone would be wrong. Returns '' for an unparseable input.
 */
export function formatStartDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
