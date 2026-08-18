// Work-session recency for ONGOING projects — the single source of truth for "when did I last
// chip at this, and how hard have I been going lately".
//
// An ongoing project is a standing effort with no finish line in sight, so the everyday gesture on
// it is "I put time in today", not "this is done". `tasks.worked_days` records the local calendar
// days that gesture was made (newest first, capped — see WORKED_DAYS_CAP), and everything anyone
// needs to know is derived here: the UI counter, the plan-request pacing rules, and the phrase the
// AI reads. One derivation, so the card, the planner and BabyClaw can never disagree.
//
// All arithmetic is pure calendar math on 'YYYY-MM-DD' wall-clock strings in the user's timezone —
// the same floating model as `due` and `start_date` (ADR 2026-07-08-due-dates-wall-clock). Never
// `new Date('YYYY-MM-DD')`: that parses as UTC midnight and lands on the previous local day west of
// UTC. The UTC-noon anchor below is immune to every DST shift.
//
// The Deno twin used by the edge functions is supabase/functions/_shared/worked.ts — keep the two
// in step (worked.test.ts and the twin's own test pin the same cases).

import { localDateInTZ } from './dates'

/**
 * Max session days retained per project. A display/volume bound, not a limit on how much you may
 * work — entry 0 is the last-worked day and never ages out, so "last worked" stays correct forever
 * however long the log is. 14 covers the longest run any pacing rule reasons about.
 *
 * Mirrored by the DB CHECK `tasks_worked_days_len` and the Deno twin; changing it means changing
 * all three plus docs/LIMITS.md and limits-reference.ts.
 */
export const WORKED_DAYS_CAP = 14

/** Derived session facts for one ongoing project. */
export interface WorkRecency {
  /** Local 'YYYY-MM-DD' of the most recent session, or null when none was ever logged. */
  lastWorked: string | null
  /** Whole days from the last session to today; 0 = today, 1 = yesterday. null when never worked. */
  daysSince: number | null
  /** Consecutive calendar days worked, counting back from `lastWorked`. 0 when never worked. */
  streak: number
  /** True when a session is already logged for today. */
  workedToday: boolean
  /** Retained session days (bounded by WORKED_DAYS_CAP — a floor on the true lifetime total). */
  sessions: number
}

/** Midday UTC for a wall-clock day, so ±hours of DST can never cross a date boundary. */
function utcNoon(iso: string): number {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  const d = Number(iso.slice(8, 10))
  return Date.UTC(y, m - 1, d, 12)
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
function dayDiff(from: string, to: string): number {
  return Math.round((utcNoon(to) - utcNoon(from)) / 86_400_000)
}

/** A well-formed 'YYYY-MM-DD' prefix, or null. Guards a malformed/legacy array element. */
function normalizeDay(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const day = value.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  // Shape alone is NOT enough. Date.UTC happily rolls an out-of-range day over into a real instant
  // ('2026-13-99' becomes 2027-02-08), so a NaN check would pass it — and because such a string is
  // numerically the largest, it would sort to the front and be read as the most recent session.
  // Round-tripping the components rejects anything that rolled.
  return new Date(utcNoon(day)).toISOString().slice(0, 10) === day ? day : null
}

/**
 * Derive session facts for a task, or null when the concept does not apply — a chore or a one-off
 * has no session log, so every caller renders nothing for them without a second type check.
 *
 * Defensive about the stored array rather than trusting it: entries are normalized, de-duplicated
 * and re-sorted newest-first here. The RPC already guarantees that shape, but a restored backup,
 * a hand-edited row, or a future writer should degrade to a sane reading, never a wrong one.
 */
export function workRecency(
  task: { ongoing?: boolean | null; worked_days?: string[] | null },
  timeZone: string,
  now: Date = new Date(),
): WorkRecency | null {
  if (!task.ongoing) return null

  const today = localDateInTZ(timeZone, now)
  const days = Array.from(
    new Set((task.worked_days ?? []).map(normalizeDay).filter((d): d is string => d !== null)),
  ).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))

  // Destructured rather than length-checked so the compiler narrows `lastWorked` to a string for
  // the rest of the function (the project builds with noUncheckedIndexedAccess).
  const [lastWorked] = days
  if (lastWorked === undefined) {
    return { lastWorked: null, daysSince: null, streak: 0, workedToday: false, sessions: 0 }
  }

  // A run is consecutive calendar days ending at the most recent session. Counting from the last
  // session (not from today) is what makes "three days running, then stopped" still read as a run
  // of three a week later — which is the shape the planner needs to avoid pushing a fourth.
  let streak = 1
  for (let i = 1; i < days.length; i += 1) {
    const newer = days[i - 1]
    const older = days[i]
    if (newer === undefined || older === undefined || dayDiff(older, newer) !== 1) break
    streak += 1
  }

  // Clamp at 0: a session dated ahead of today (device-clock skew the RPC's ±2-day window still
  // admits) reads as "today", never as a negative age that would sort before everything.
  const daysSince = Math.max(0, dayDiff(lastWorked, today))

  return { lastWorked, daysSince, streak, workedToday: daysSince === 0, sessions: days.length }
}

/**
 * The tight token for a card or row — deliberately 1–2 glyphs wide, because it shares the badge
 * lane with the due chip and the ∞ marker. '' when the task has never been worked, so the caller
 * renders nothing rather than an apologetic zero.
 */
export function workedShort(recency: WorkRecency | null): string {
  if (!recency || recency.daysSince === null) return ''
  return recency.workedToday ? '✓ today' : `${recency.daysSince}d`
}

/**
 * The full human sentence — a tooltip/aria label on the card, and the SchedulePanel readback.
 *
 * Purely factual by design. It never characterises a gap ("neglected", "overdue for a session"):
 * dropping a project for three weeks and picking it back up is normal, healthy use of an ongoing
 * project, and the copy must not imply otherwise.
 */
export function workedDetail(recency: WorkRecency | null): string {
  if (!recency) return ''
  if (recency.daysSince === null) return 'No sessions logged yet'

  const when = recency.workedToday
    ? 'Worked today'
    : recency.daysSince === 1
      ? 'Worked yesterday'
      : `Last worked ${recency.daysSince} days ago`

  const run = recency.streak >= 2 ? `, ${recency.streak} days running` : ''
  const total =
    recency.sessions >= 2
      ? ` · ${recency.sessions}${recency.sessions >= WORKED_DAYS_CAP ? '+' : ''} sessions logged`
      : ''

  return `${when}${run}${total}`
}
