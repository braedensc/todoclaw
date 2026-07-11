// Recurring-task status. Ported from EisenClaw `recurringStatus` / `RC_COLOR` /
// `fmtFrequency` (planning/EISENCLAW-LOGIC-TO-PORT.md §3, html:57-69, 97-107).

import type { Recurring } from '../types/task'
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

/** True when this recurring shape is an ONGOING project rather than a repeating chore. */
export function isOngoing(recurring: Recurring | null | undefined): boolean {
  return !!recurring?.ongoing
}

export interface OngoingStatus {
  /** Lifetime work sessions logged (recurring.doneCount). */
  sessions: number
  /** Target-end countdown phrase ("target today" / "target in 5d" / "target 3d ago"), or null. */
  target: string | null
}

/**
 * Presentation bits for an ONGOING task's badge/readback, or `null` for a non-ongoing task.
 *
 * `sessions` is the lifetime work-session count; `target` renders the target-end countdown
 * (timezone-aware via `daysUntil`) when a `targetEnd` is set. Resurfacing pressure and the status
 * COLOR still come from `recurringStatus` (the check-in cadence) — this only supplies the
 * project-framed labelling that replaces a chore's "due today / overdue Nd".
 */
export function ongoingLabel(
  recurring: Recurring | null | undefined,
  opts: { now?: Date; timeZone?: string } = {},
): OngoingStatus | null {
  if (!recurring?.ongoing) return null
  const sessions = recurring.doneCount ?? 0
  let target: string | null = null
  if (recurring.targetEnd) {
    const d = daysUntil(recurring.targetEnd, { timeZone: opts.timeZone ?? 'UTC', now: opts.now })
    if (d != null) {
      target = d < 0 ? `target ${Math.abs(d)}d ago` : d === 0 ? 'target today' : `target in ${d}d`
    }
  }
  return { sessions, target }
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
