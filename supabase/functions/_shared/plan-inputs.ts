// plan-inputs.ts — build the Plan My Day request from RAW task/habit rows, SERVER-SIDE. The
// client normally assembles this from src/lib (scoring + recurring); BabyClaw's generate_plan tool
// runs the plan without a client round-trip, so the same selection + date math is ported here.
// Faithful to src/features/ai/use-plan-my-day.ts buildPlanRequest + src/lib recurringStatus/daysUntil.

import { dayNameInTZ, daysUntilInTZ, localDateInTZ } from './dates.ts'
import { recurringStatus } from './recurring-status.ts'
import { workRecency, workedPhrase } from './worked.ts'
import { SIZE_VALUES, UPCOMING_WINDOW_DAYS, type PlanRequest } from './plan-prompt.ts'

// The tasks row comes back untyped (a bare text `size`); narrow it to the S/M/L/XL enum the plan
// request expects. The DB CHECK guarantees the value, but TS only sees `string | null`, so guard.
const SIZE_SET = new Set<string>(SIZE_VALUES)
function toPlanSize(v: string | null | undefined): (typeof SIZE_VALUES)[number] | null {
  return v && SIZE_SET.has(v) ? (v as (typeof SIZE_VALUES)[number]) : null
}

interface TaskRow {
  id: string
  text: string
  x: number | null
  y: number | null
  due: string | null
  due_time: string | null
  // Optional: run-plan.ts selects it, and the dispatch RPC provides it, but keeping it optional lets
  // an old-shaped source (deploy skew) still satisfy the type — toPlanSize maps a missing value to null.
  size?: string | null
  staged: boolean
  recurring: {
    frequencyDays: number
    lastDoneAt: string | null
    doneCount: number
    // One-shot occurrence override ("do it on Friday") — read by recurringStatus.
    nextDueOn?: string | null
  } | null
  // ONGOING project flag (own column since 2026-07-13). Optional so an old-shaped source still fits.
  ongoing?: boolean | null
  // Session log for an ongoing project: local 'YYYY-MM-DD' days, newest first (2026-07-28). Optional
  // for the same deploy-skew reason — a source that predates it reads as "no sessions logged".
  worked_days?: string[] | null
  // Start (pause-until) wall-clock date (2026-07-17). Optional for the same deploy-skew reason —
  // and the dispatch RPC already excludes dormant tasks in SQL, so its rows simply omit it.
  start_date?: string | null
}
interface HabitRow {
  text: string
  active: boolean
}

// Selection: on-grid = not staged, not done today, not a recurring chore (ONGOING projects ARE
// included — they are placed tasks flagged so the planner can pace them); plus recurring chores that
// are overdue/due/soon; plus active habits.
//
// A project already worked TODAY stays in `tasks` too, carrying workedToday: it is excluded from the
// ROCK CANDIDATES at render time (plan-prompt.ts taskLines), NOT here — `tasks` is also what
// deriveAnchors reads, so dropping one here would strip the fixed-time anchor off an ongoing project
// due at 2 PM today (the regression PRs #344/#345 closed).
export function buildPlanRequest(
  tasks: TaskRow[],
  habits: HabitRow[],
  doneMap: Record<string, boolean>,
  timeZone: string,
  now: Date,
): PlanRequest {
  // Dormant = paused (future start date, user's local day). Mirrors src/lib/start-date.ts
  // isDormant and the dispatch RPC's SQL gate: a paused task never reaches a plan of either kind.
  const today = localDateInTZ(timeZone, now)
  const dormant = (t: TaskRow) => !!t.start_date && t.start_date.slice(0, 10) > today

  const planTasks = tasks
    .filter(
      (t) =>
        !t.staged && !doneMap[t.id] && !t.recurring && !dormant(t) && t.x != null && t.y != null,
    )
    .map((t) => {
      // Session recency for an ONGOING project (null for anything else). Derived HERE, once, so the
      // request carries finished facts and the prompt layer stays a pure renderer — the same split
      // as importance/urgency/dueInDays. `worked` is deliberately raw fact with no verdict word in
      // it (see workedPhrase); a never-worked project says so plainly rather than rendering nothing,
      // because "no signal yet" is itself the thing the planner has to know.
      const recency = workRecency(t, timeZone, now)
      return {
        id: t.id, // ties emitted rocks back to the task (resolvePlanTaskIds)
        text: t.text,
        importance: Math.round((t.y ?? 0.5) * 100),
        urgency: Math.round((t.x ?? 0.5) * 100),
        due: t.due,
        dueInDays: daysUntilInTZ(t.due, timeZone, now),
        dueTime: t.due_time,
        size: toPlanSize(t.size),
        ongoing: t.ongoing ?? false,
        workedToday: recency?.workedToday ?? false,
        worked: recency ? workedPhrase(recency) || 'no sessions logged yet' : '',
      }
    })

  // Recurring chores worth mentioning: anything the ladder does NOT call 'ok' (overdue / never done
  // / due today / due tomorrow / soon). `daysLeft` rides along so the plan card's "chores due today"
  // strip can select on a NUMBER rather than pattern-matching the display label (deriveChores).
  const recurringDue: PlanRequest['recurringDue'] = []
  for (const t of tasks) {
    if (dormant(t)) continue // a paused chore sits out its pause too
    const s = recurringStatus(t.recurring, timeZone, now)
    if (s && s.code !== 'ok') {
      recurringDue.push({ id: t.id, text: t.text, status: s.label, daysLeft: s.daysLeft })
    }
  }

  // Dormant tasks that un-pause SOON (start within UPCOMING_WINDOW_DAYS): kept OUT of `tasks`
  // (never scheduled) but collected as gentle "coming up" heads-ups. Mirrors the client twin in
  // src/features/ai/use-plan-my-day.ts. dormant(t) guarantees start_date is set and future, so
  // startsInDays is >= 1; the run-plan/dispatch sources already exclude completed rows.
  const upcoming: PlanRequest['upcoming'] = []
  for (const t of tasks) {
    if (!dormant(t)) continue
    const startsInDays = daysUntilInTZ(t.start_date ?? null, timeZone, now)
    if (startsInDays != null && startsInDays <= UPCOMING_WINDOW_DAYS) {
      upcoming.push({
        id: t.id,
        text: t.text,
        startsInDays,
        startDate: (t.start_date as string).slice(0, 10),
        due: t.due,
      })
    }
  }

  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(now)

  return {
    today: fmt({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    dayOfWeek: dayNameInTZ(timeZone, now),
    tasks: planTasks,
    recurringDue,
    habits: habits.filter((h) => h.active).map((h) => h.text),
    upcoming,
  }
}
