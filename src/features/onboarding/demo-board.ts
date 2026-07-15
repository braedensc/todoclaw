import type { Task } from '../../types/task'
import type { Habit } from '../../types/habit'
import { localDateInTZ } from '../../lib/dates'
import { DEMO_MORNING_INPUTS } from './demo-transcript'

// The demo tour's app-typed fixtures — the example board and the example day's habits (the plan and
// the check-in texts live in demo-transcript.ts, which stays dependency-free so a Deno test can
// import it).
//
// The board: ~9 generic tasks (the PR #220 Alex/Portland norm — no real
// people, cities, or chores from anyone's actual list) authored RELATIVE to the real "today" so
// the board always renders mid-story: a due-today glow, a timed task, a 2-card cluster, a
// recurring chore on its cycle, an ongoing project, and one long-ignored ❄️ stale card. Every
// visual state the fixture intentionally exercises is listed below — when a new card treatment
// ships (the ❄️ badge, say), extend the fixture so the demo shows it off:
//
//   • due-today glow ......... 'Send the invoice' (due today)
//   • timed due / countdown .. 'Call the vet' (due today at 4:30 PM — matches the morning push)
//   • near-due warmth ........ 'Book the dentist' (due in 2 days)
//   • recurring ↻ chore ...... 'Water the plants' (3-day cadence, last done 3 days ago → due)
//   • ongoing project ........ 'Learn Spanish'
//   • 2-card cluster ......... 'Plan the camping trip' + 'Book the campsite' (Δx .02 < CX .09,
//                              Δy .02 < CY .07 — clusters into one bubble)
//   • ❄️ stale (ignored) ..... 'Clean out the garage' (undated, on the board ~95 days ≥ the 90d
//                              floor; every other undated card stays far under it)
//   • effort size ............ sizes set on two tasks (feeds Plan My Day; not drawn on cards)
//   • all four quadrants ..... 3 / 3 / 1 / 2 spread so the mobile 2×2 overview fully lights up
//
// Task NAMES deliberately match the canned plan + check-ins (demo-transcript.ts) so the plan card,
// the morning push, and the board read as one coherent day.

const DAY_MS = 86_400_000

/** The calendar date `days` from now in `timeZone` (fixture-grade — DST drift is irrelevant here). */
function dateFromToday(timeZone: string, days: number): string {
  return localDateInTZ(timeZone, new Date(Date.now() + days * DAY_MS))
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString()
}

const base = {
  user_id: 'demo',
  due: null,
  due_time: null,
  staged: false,
  bucket: 'oneoff' as const,
  recurring: null,
  ongoing: false,
  size: null,
  deleted_at: null,
  completed_at: null,
}

/** Build the example tasks for "today" in `timeZone`. Pure; a fresh array per call. */
export function buildDemoTasks(timeZone: string): Task[] {
  const today = dateFromToday(timeZone, 0)
  return [
    {
      ...base,
      id: 'demo-invoice',
      text: 'Send the invoice',
      x: 0.82,
      y: 0.78,
      due: today,
      size: 'M',
      created_at: isoDaysAgo(9),
    },
    {
      ...base,
      id: 'demo-vet',
      text: 'Call the vet',
      x: 0.88,
      y: 0.6,
      due: today,
      due_time: '16:30:00',
      created_at: isoDaysAgo(2),
    },
    {
      ...base,
      id: 'demo-dentist',
      text: 'Book the dentist',
      x: 0.62,
      y: 0.35,
      due: dateFromToday(timeZone, 2),
      created_at: isoDaysAgo(6),
    },
    {
      ...base,
      id: 'demo-plants',
      text: 'Water the plants',
      x: 0.45,
      y: 0.3,
      recurring: { frequencyDays: 3, lastDoneAt: isoDaysAgo(3), doneCount: 12 },
      bucket: null,
      created_at: isoDaysAgo(40),
    },
    {
      ...base,
      id: 'demo-spanish',
      text: 'Learn Spanish',
      x: 0.2,
      y: 0.72,
      ongoing: true,
      created_at: isoDaysAgo(30),
    },
    {
      ...base,
      id: 'demo-camping',
      text: 'Plan the camping trip',
      x: 0.35,
      y: 0.72,
      due: dateFromToday(timeZone, 6),
      created_at: isoDaysAgo(12),
    },
    {
      ...base,
      id: 'demo-campsite',
      text: 'Book the campsite',
      x: 0.37,
      y: 0.7,
      due: dateFromToday(timeZone, 5),
      created_at: isoDaysAgo(12),
    },
    {
      ...base,
      id: 'demo-garage',
      text: 'Clean out the garage',
      x: 0.25,
      y: 0.25,
      created_at: isoDaysAgo(95),
    },
    {
      ...base,
      id: 'demo-passport',
      text: 'Renew the passport',
      x: 0.55,
      y: 0.8,
      due: dateFromToday(timeZone, 30),
      size: 'L',
      created_at: isoDaysAgo(20),
    },
  ]
}

// The example day's habits, DERIVED from the transcript fixture rather than retyped: the same two
// habits are pinned into the morning push (demo-transcript.ts's 💪 HABITS block, drift-guarded by
// the Deno test), so the strip the tour spotlights and the push it showed two panels earlier can
// never disagree about what today's routines are.
//
// Load-bearing, not decoration: the scene mounts the REAL RemindersInline over these, and that
// component renders NOTHING when no habit is active — an empty fixture would leave the tour's
// habits panel spotlighting a zero-height sliver, silently.
export function buildDemoHabits(): Habit[] {
  return DEMO_MORNING_INPUTS.habits.map(
    (habit, i): Habit => ({
      ...habit, // id / text / active — the transcript is the single source for the names
      user_id: 'demo',
      subtasks: [],
      created_at: isoDaysAgo(60 - i), // habits display oldest-first; keep the order stable
      deleted_at: null,
    }),
  )
}

/**
 * Today's habit checkmarks — the first ticked, the rest not, so the strip shows BOTH treatments
 * (a checked paw + a plain one) and a partial "treats earned" tally. An all-done map would fill the
 * tally solid and hide the un-ticked look entirely.
 */
export const DEMO_HABIT_DONE: Record<string, boolean> = {
  [DEMO_MORNING_INPUTS.habits[0]!.id]: true,
}
