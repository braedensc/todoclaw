// Priority scoring. Ported from EisenClaw `daysUntil` / `taskScore`
// (planning/EISENCLAW-LOGIC-TO-PORT.md §2, html:44-55).
//
// EisenClaw computed `daysUntil` against the BROWSER's local midnight (a real
// inconsistency with its UTC daily-reset — Discrepancy #3). We compute it against the
// user's stored IANA timezone so it agrees with the daily reset and `daily_state.date`
// partitioning. `localDateInTZ` gives a locale-independent, DST-safe calendar date.

import type { Task } from '../types/task'
import { localDateInTZ } from './dates'

const MS_PER_DAY = 86_400_000

/** A bare `YYYY-MM-DD` calendar date with no time component. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Whole-number calendar days between a 'YYYY-MM-DD' string and the UTC-midnight epoch. */
function dayNumber(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`) / MS_PER_DAY
}

/**
 * The calendar date a `due` value falls on, in the user's timezone.
 *
 * A bare `YYYY-MM-DD` (what the date picker stores) is a *floating* calendar date — the day the
 * user picked, in their own calendar — so it is used verbatim. It must NOT be routed through
 * `new Date()`, which parses it as UTC midnight: west of UTC that lands on the previous local day,
 * making a task read as overdue on its own due date. A `due` that carries a time component is a
 * real instant, so it is projected into `timeZone` like "now".
 */
function dueCalendarDate(due: string, timeZone: string): string {
  return DATE_ONLY.test(due) ? due : localDateInTZ(timeZone, new Date(due))
}

export interface ScoringOpts {
  /** IANA timezone (e.g. 'America/New_York') — the user's `user_schedule.timezone`. */
  timeZone: string
  /** Injected for deterministic tests; defaults to the real current instant. */
  now?: Date
}

/**
 * Whole-number calendar-day difference between `due` and "now", both evaluated in the
 * user's timezone. Returns `null` when there is no due date.
 *
 * Negative = overdue, 0 = due today, positive = days remaining — so a task is overdue only the
 * day *after* its due date, never on the due date itself. Because both ends are collapsed to a
 * calendar date in `timeZone` before diffing, the result is DST-safe and independent of the
 * time-of-day component of either instant.
 */
export function daysUntil(due: string | null, opts: ScoringOpts): number | null {
  if (!due) return null
  const { timeZone, now = new Date() } = opts
  const dueDay = dayNumber(dueCalendarDate(due, timeZone))
  const nowDay = dayNumber(localDateInTZ(timeZone, now))
  return Math.round(dueDay - nowDay)
}

/**
 * Priority score: `x*0.45 + y*0.55 + (daysUntil <= 2 ? 0.18 : 0)` (html:51-55).
 *
 * Importance (y, weight 0.55) is weighted above urgency (x, weight 0.45); a flat 0.18
 * bonus applies when the task is due within 2 days. Staged tasks may have null coords,
 * so null x or y is treated as 0.5 (grid center) — never produces NaN.
 */
export function taskScore(t: Task, opts: ScoringOpts): number {
  const x = t.x ?? 0.5
  const y = t.y ?? 0.5
  const d = daysUntil(t.due, opts)
  const dueBonus = d !== null && d <= 2 ? 0.18 : 0
  return x * 0.45 + y * 0.55 + dueBonus
}
