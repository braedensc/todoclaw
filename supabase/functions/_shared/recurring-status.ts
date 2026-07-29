// recurring-status.ts — the ONE edge-side cadence ladder.
//
// This is the Deno-tree mirror of src/lib/recurring.ts `recurringStatus` (the frontend build tree
// and the edge tree can't import from each other, so the math exists exactly twice — no more).
// It used to exist THREE times, and had already drifted: `plan-inputs.ts` returned `{label, due}`
// while `chat-context.ts` computed its own thresholds and emitted a different string for the same
// state. Both now call this.
//
// Callers that need surface-specific wording build it from `code`/`daysLeft` rather than
// re-deriving the arithmetic — and NOTHING makes a control-flow decision by matching `label`,
// which is display text (see deriveChores in plan-prompt.ts, which filters on `daysLeft`).

import { daysUntilInTZ, localDateInTZ } from './dates.ts'

const MS_PER_DAY = 86_400_000

export type RecurringCode = 'overdue' | 'due' | 'soon' | 'ok'

/** The `recurring` jsonb, as far as the ladder cares. */
export interface RecurringInput {
  frequencyDays?: number
  lastDoneAt?: string | null
  /** One-shot occurrence override — the wall-clock day this occurrence is wanted on. */
  nextDueOn?: string | null
}

export interface RecurringStatus {
  /** Compact display label, identical to the client's: 'due today' | 'overdue 3d' | 'in 4d' | … */
  label: string
  code: RecurringCode
  daysLeft: number
}

/**
 * The ladder, keyed on `daysLeft` alone — same thresholds and same labels as the client's
 * `statusFromDaysLeft`, so the cadence clock and a `nextDueOn` override are indistinguishable
 * downstream.
 */
function statusFromDaysLeft(daysLeft: number): RecurringStatus {
  if (daysLeft < -1) return { label: `overdue ${Math.abs(daysLeft)}d`, code: 'overdue', daysLeft }
  if (daysLeft <= 1) {
    return { label: daysLeft <= 0 ? 'due today' : 'due tomorrow', code: 'due', daysLeft }
  }
  if (daysLeft <= 5) return { label: `in ${daysLeft}d`, code: 'soon', daysLeft }
  return { label: `in ${daysLeft}d`, code: 'ok', daysLeft }
}

/**
 * `daysLeft` from a live `nextDueOn` override, or `null` when none is in force.
 *
 * Mirrors the client's `overrideDaysLeft`: the override retires at READ time once a completion has
 * caught up with it, so a writer that forgets to clear the field can't pin a chore to "due today"
 * forever. Calendar-day math, so it can't drift on a 23- or 25-hour DST day.
 */
function overrideDaysLeft(rec: RecurringInput, timeZone: string, now: Date): number | null {
  const on = rec.nextDueOn?.slice(0, 10)
  if (!on) return null
  if (rec.lastDoneAt != null) {
    if (localDateInTZ(timeZone, new Date(rec.lastDoneAt)) >= on) return null
  }
  return daysUntilInTZ(on, timeZone, now)
}

/**
 * Status of a recurring task relative to `now`, or `null` for a non-recurring one.
 *
 * Precedence: a live `nextDueOn` override, then never-done (deeply overdue), then the cadence clock
 * (`frequencyDays - daysSinceLastDone`).
 */
export function recurringStatus(
  rec: RecurringInput | null | undefined,
  timeZone: string,
  now: Date,
): RecurringStatus | null {
  if (!rec || !rec.frequencyDays) return null

  const override = overrideDaysLeft(rec, timeZone, now)
  if (override != null) return statusFromDaysLeft(override)

  if (rec.lastDoneAt == null) return { label: 'never done', code: 'overdue', daysLeft: -999 }

  const daysSince = Math.floor((now.getTime() - Date.parse(rec.lastDoneAt)) / MS_PER_DAY)
  return statusFromDaysLeft(rec.frequencyDays - daysSince)
}

/**
 * Was this recurring task completed on the CURRENT local day? Mirrors src/lib/recurring.ts
 * `recurringDoneToday` — a recurring completion never enters `daily_state.done`, so every surface
 * that hides done tasks needs this too.
 */
export function recurringDoneToday(
  rec: RecurringInput | null | undefined,
  timeZone: string,
  now: Date,
): boolean {
  if (!rec?.lastDoneAt) return false
  return localDateInTZ(timeZone, new Date(rec.lastDoneAt)) === localDateInTZ(timeZone, now)
}

/**
 * The `recurring` patch recording a COMPLETION: the real instant, one more done, and any one-shot
 * override cleared so the cadence resumes from when the chore was actually done. Mirrors the
 * client's `recurringCompletion`.
 */
export function recurringCompletion<T extends RecurringInput>(rec: T, now: Date): T {
  return {
    ...rec,
    lastDoneAt: now.toISOString(),
    doneCount: ((rec as { doneCount?: number }).doneCount ?? 0) + 1,
    nextDueOn: null,
  }
}

/**
 * The `recurring` patch that UNDOES the most recent completion: rewind the stamp by one cadence and
 * un-count it. A pure rewind — restoring a completion from two days ago reads `overdue 2d`, which is
 * the honest answer (the previous stamp isn't stored). Returns `null` when there is nothing to undo.
 */
export function recurringRestore<T extends RecurringInput>(rec: T): T | null {
  if (!rec.lastDoneAt) return null
  const freq = Math.max(Math.trunc(rec.frequencyDays ?? 1) || 1, 1)
  return {
    ...rec,
    lastDoneAt: new Date(Date.parse(rec.lastDoneAt) - freq * MS_PER_DAY).toISOString(),
    doneCount: Math.max(0, ((rec as { doneCount?: number }).doneCount ?? 0) - 1),
    nextDueOn: null,
  }
}
