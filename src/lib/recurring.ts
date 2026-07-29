// Recurring-task status. Ported from EisenClaw `recurringStatus` / `RC_COLOR` /
// `fmtFrequency` (planning/EISENCLAW-LOGIC-TO-PORT.md §3, html:57-69, 97-107).

import type { Recurring } from '../types/task'
import { localDateInTZ } from './dates'

const MS_PER_DAY = 86_400_000

export type RecurringCode = 'overdue' | 'due' | 'soon' | 'ok'

export interface RecurringStatus {
  label: string
  code: RecurringCode
  daysLeft: number
}

/** Status accent colors keyed by code (html:69). */
export const RC_COLOR: Record<RecurringCode, string> = {
  overdue: '#c2693f',
  due: '#b8862a',
  soon: '#8a7828',
  ok: '#5b8a72',
}

export interface RecurringOpts {
  /** Injected for deterministic tests; defaults to the real current instant. */
  now?: Date
}

/**
 * Status of a recurring task relative to "now" (html:57-67).
 *
 * Returns `null` for a non-recurring task (no `recurring` object or no `frequencyDays`).
 * A recurring task that has never been done is treated as deeply overdue
 * (`daysLeft: -999`). Otherwise `daysLeft = frequencyDays - daysSinceLastDone`:
 * - `< -1` → overdue, `1` → due tomorrow, `<= 0` → due today, `<= 5` → soon, else ok.
 */
export function recurringStatus(
  recurring: Recurring | null | undefined,
  opts: RecurringOpts = {},
): RecurringStatus | null {
  if (!recurring || !recurring.frequencyDays) return null

  if (recurring.lastDoneAt == null) {
    return { label: 'never done', code: 'overdue', daysLeft: -999 }
  }

  const now = opts.now ?? new Date()
  const daysSince = Math.floor((now.getTime() - Date.parse(recurring.lastDoneAt)) / MS_PER_DAY)
  const daysLeft = recurring.frequencyDays - daysSince

  if (daysLeft < -1) {
    return { label: `overdue ${Math.abs(daysLeft)}d`, code: 'overdue', daysLeft }
  }
  if (daysLeft <= 1) {
    return { label: daysLeft <= 0 ? 'due today' : 'due tomorrow', code: 'due', daysLeft }
  }
  if (daysLeft <= 5) {
    return { label: `in ${daysLeft}d`, code: 'soon', daysLeft }
  }
  return { label: `in ${daysLeft}d`, code: 'ok', daysLeft }
}

/**
 * Was this recurring task last completed on the CURRENT local day (in `timeZone`)?
 *
 * The board surfaces (grid, mobile) use this to hide a just-completed recurring task for the rest
 * of the local day, so marking it done gives visible feedback — otherwise a short-cadence chore
 * (≤5d) re-reads as `due`/`soon` immediately and never leaves the board, so "done" looks like it
 * did nothing. It reappears the next local day, when its cadence next reads as due/soon. Recurring
 * completion writes `recurring.lastDoneAt` (recurring tasks never set `tasks.completed_at`), so
 * that stamp is the signal. Returns false for a non-recurring or never-done task.
 *
 * Local-calendar-day based (not a rolling 24h) to match the rest of the app's day model — the
 * daily reset and the one-off `daily_state.done` map are both keyed by the user-local date.
 */
export function recurringDoneToday(
  recurring: Recurring | null | undefined,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (!recurring?.lastDoneAt) return false
  return localDateInTZ(timeZone, new Date(recurring.lastDoneAt)) === localDateInTZ(timeZone, now)
}

/**
 * Human-friendly cadence label for a frequency in days (html:97-107).
 *
 * Ladder: ≤3 → `every Nd`; 7 → `weekly`; ≤13 → `every Nd`; 14 → `every 2wk`;
 * 21 → `every 3wk`; ≤32 → `monthly`; ≤42 → `every ~5wk`; ≤65 → `every ~2mo`;
 * else → `every ~3mo`.
 */
export function fmtFrequency(days: number): string {
  if (days <= 3) return `every ${days}d`
  if (days === 7) return 'weekly'
  if (days <= 13) return `every ${days}d`
  if (days === 14) return 'every 2wk'
  if (days === 21) return 'every 3wk'
  if (days <= 32) return 'monthly'
  if (days <= 42) return 'every ~5wk'
  if (days <= 65) return 'every ~2mo'
  return 'every ~3mo'
}
