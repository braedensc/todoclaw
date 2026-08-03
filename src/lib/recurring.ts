// Recurring-task status. Ported from EisenClaw `recurringStatus` / `RC_COLOR` /
// `fmtFrequency` (planning/EISENCLAW-LOGIC-TO-PORT.md §3, html:57-69, 97-107).

import type { Recurring } from '../types/task'
import { localDateInTZ } from './dates'
import { daysUntil } from './scoring'

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
  /**
   * IANA timezone (e.g. 'America/New_York') — the user's `user_schedule.timezone`. REQUIRED, like
   * `ScoringOpts`: a `nextDueOn` override is a wall-clock DAY, so reading it needs the same
   * authority the daily reset uses. Callers get it from `useTimeZone()`, never a local fallback.
   */
  timeZone: string
  /** Injected for deterministic tests; defaults to the real current instant. */
  now?: Date
}

/**
 * The status ladder, keyed on `daysLeft` alone (html:57-67):
 * `< -1` → overdue, `1` → due tomorrow, `<= 0` → due today, `<= 5` → soon, else ok.
 *
 * Split out so the cadence clock and a `nextDueOn` override produce IDENTICAL labels/codes for the
 * same `daysLeft` — that sameness is what lets every reader honor an override without knowing it
 * exists.
 */
function statusFromDaysLeft(daysLeft: number): RecurringStatus {
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
 * `daysLeft` from a live `nextDueOn` override, or `null` when there is no override in force.
 *
 * The override RETIRES at read time once a completion has caught up with it (`lastDoneAt` landing
 * on or after the scheduled day) — the same self-healing, no-cron shape as `isDormant`/`start_date`.
 * Every completion path also clears the field explicitly; this is the belt-and-braces half, so a
 * writer that forgets can't pin a chore to "due today" forever.
 *
 * Calendar-day math (via `daysUntil`), not the cadence clock's rolling 24h: "is this wanted today"
 * is a question about the user's calendar, so it can't drift on a 23- or 25-hour DST day.
 */
function overrideDaysLeft(recurring: Recurring, timeZone: string, now: Date): number | null {
  const on = recurring.nextDueOn
  if (!on) return null
  if (recurring.lastDoneAt != null) {
    const doneOn = localDateInTZ(timeZone, new Date(recurring.lastDoneAt))
    if (doneOn >= on.slice(0, 10)) return null // already done on/after the day it was wanted
  }
  return daysUntil(on.slice(0, 10), { timeZone, now })
}

/**
 * Status of a recurring task relative to "now" (html:57-67).
 *
 * Returns `null` for a non-recurring task (no `recurring` object or no `frequencyDays`).
 * Precedence:
 * 1. a live `nextDueOn` override ("I need to do this on Friday") — calendar days until that day;
 * 2. never done → deeply overdue (`daysLeft: -999`);
 * 3. the cadence clock — `daysLeft = frequencyDays - daysSinceLastDone`.
 */
export function recurringStatus(
  recurring: Recurring | null | undefined,
  opts: RecurringOpts,
): RecurringStatus | null {
  if (!recurring || !recurring.frequencyDays) return null

  const { timeZone, now = new Date() } = opts

  const override = overrideDaysLeft(recurring, timeZone, now)
  if (override != null) return statusFromDaysLeft(override)

  if (recurring.lastDoneAt == null) {
    return { label: 'never done', code: 'overdue', daysLeft: -999 }
  }

  const daysSince = Math.floor((now.getTime() - Date.parse(recurring.lastDoneAt)) / MS_PER_DAY)
  return statusFromDaysLeft(recurring.frequencyDays - daysSince)
}

/**
 * The `recurring` patch that records a COMPLETION: the real completion instant, one more done, and
 * the one-shot override cleared so the cadence resumes from when the chore was actually done.
 *
 * Every completion path (list, grid, BabyClaw's `complete_task`) goes through this — the field is
 * easy to drop when spreading `{ ...recurring }`, and forgetting it would pin the chore to its
 * scheduled day forever.
 */
export function recurringCompletion(recurring: Recurring, now: Date = new Date()): Recurring {
  return {
    ...recurring,
    lastDoneAt: now.toISOString(),
    doneCount: (recurring.doneCount ?? 0) + 1,
    nextDueOn: null,
  }
}

/**
 * The `recurring` patch that UNDOES the most recent completion: rewind the completion stamp by one
 * cadence and un-count it, so the chore reads due again from where it actually stood.
 *
 * A pure rewind of the stamp — deliberately NOT "anchor it so it reads due TODAY". Restoring a
 * completion from two days ago should read `overdue 2d`, which is what the plain arithmetic gives.
 * Returns `null` when there is nothing to undo.
 */
export function recurringRestore(recurring: Recurring): Recurring | null {
  if (!recurring.lastDoneAt) return null
  const freq = Math.max(Math.trunc(recurring.frequencyDays) || 1, 1)
  return {
    ...recurring,
    lastDoneAt: new Date(Date.parse(recurring.lastDoneAt) - freq * MS_PER_DAY).toISOString(),
    doneCount: Math.max(0, (recurring.doneCount ?? 0) - 1),
    nextDueOn: null,
  }
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
