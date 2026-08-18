// Deno twin of src/lib/worked.ts — work-session recency for ONGOING projects.
//
// The client renders the counter from its copy; Plan My Day and BabyClaw derive the pacing facts
// from this one. Both must read a given worked_days array identically, or the card would disagree
// with what the planner was told about the same project. Keep the two in step — each has a test
// pinning the same cases.
//
// Kept as a hand-synced twin rather than a shared import for the same reason every other _shared
// module is: the edge functions run Deno with URL imports and cannot reach into src/.

import { localDateInTZ } from './dates.ts'

/** Mirrors WORKED_DAYS_CAP in src/lib/worked.ts and the DB CHECK tasks_worked_days_len. */
export const WORKED_DAYS_CAP = 14

export interface WorkRecency {
  lastWorked: string | null
  daysSince: number | null
  streak: number
  workedToday: boolean
  sessions: number
}

function utcNoon(iso: string): number {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  const d = Number(iso.slice(8, 10))
  return Date.UTC(y, m - 1, d, 12)
}

function dayDiff(from: string, to: string): number {
  return Math.round((utcNoon(to) - utcNoon(from)) / 86_400_000)
}

function normalizeDay(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const day = value.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  // Date.UTC rolls an out-of-range day over into a real instant ('2026-13-99' -> 2027-02-08), and
  // such a string sorts numerically LAST — i.e. it would be read as the most recent session. Round-
  // trip to reject it. See src/lib/worked.ts for the full note.
  return new Date(utcNoon(day)).toISOString().slice(0, 10) === day ? day : null
}

/** See src/lib/worked.ts for the full rationale. Returns null when the task is not ongoing. */
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

  // Destructured, not length-checked, so the compiler narrows `lastWorked` to a string — matching
  // the client copy, which must satisfy noUncheckedIndexedAccess.
  const [lastWorked] = days
  if (lastWorked === undefined) {
    return { lastWorked: null, daysSince: null, streak: 0, workedToday: false, sessions: 0 }
  }

  let streak = 1
  for (let i = 1; i < days.length; i += 1) {
    const newer = days[i - 1]
    const older = days[i]
    if (newer === undefined || older === undefined || dayDiff(older, newer) !== 1) break
    streak += 1
  }

  const daysSince = Math.max(0, dayDiff(lastWorked, today))

  return { lastWorked, daysSince, streak, workedToday: daysSince === 0, sessions: days.length }
}

/**
 * The one line of session context the model sees on a task, appended to its task line.
 *
 * RAW FACTS ONLY — deliberately no verdict vocabulary ("resting", "cooling", "due for a session").
 * A verdict word gets treated as a switch and produces a mechanical every-N-days cadence; the
 * prompt's prose plus these facts is what lets the pacing stay varied and human. Returns '' for a
 * project with no sessions yet so the task line stays clean.
 */
export function workedPhrase(recency: WorkRecency | null): string {
  if (!recency || recency.daysSince === null) return ''

  const when = recency.workedToday
    ? 'worked today'
    : recency.daysSince === 1
      ? 'worked yesterday'
      : `last worked ${recency.daysSince} days ago`

  return recency.streak >= 2 ? `${when}, ${recency.streak} days running` : when
}
