// plan-inputs.ts — build the Plan My Day request from RAW task/habit rows, SERVER-SIDE. The
// client normally assembles this from src/lib (scoring + recurring); BabyClaw's generate_plan tool
// runs the plan without a client round-trip, so the same selection + date math is ported here.
// Faithful to src/features/ai/use-plan-my-day.ts buildPlanRequest + src/lib recurringStatus/daysUntil.

import { dayNameInTZ, daysUntilInTZ, localDateInTZ } from './dates.ts'
import { SIZE_VALUES, type PlanRequest } from './plan-prompt.ts'

const MS_PER_DAY = 86_400_000

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
  recurring: { frequencyDays: number; lastDoneAt: string | null; doneCount: number } | null
  // ONGOING project flag (own column since 2026-07-13). Optional so an old-shaped source still fits.
  ongoing?: boolean | null
  // Start (pause-until) wall-clock date (2026-07-17). Optional for the same deploy-skew reason —
  // and the dispatch RPC already excludes dormant tasks in SQL, so its rows simply omit it.
  start_date?: string | null
}
interface HabitRow {
  text: string
  active: boolean
}

// Recurring status, reduced to what the plan request needs (label + whether it's due-ish). Mirrors
// src/lib/recurring.ts recurringStatus.
function recurringStatus(
  recurring: TaskRow['recurring'],
  now: Date,
): { label: string; due: boolean } | null {
  if (!recurring || !recurring.frequencyDays) return null
  if (recurring.lastDoneAt == null) return { label: 'never done', due: true }
  const daysSince = Math.floor((now.getTime() - Date.parse(recurring.lastDoneAt)) / MS_PER_DAY)
  const daysLeft = recurring.frequencyDays - daysSince
  if (daysLeft < -1) return { label: `overdue ${Math.abs(daysLeft)}d`, due: true }
  if (daysLeft <= 1) return { label: daysLeft <= 0 ? 'due today' : 'due tomorrow', due: true }
  if (daysLeft <= 5) return { label: `in ${daysLeft}d`, due: true } // 'soon'
  return { label: `in ${daysLeft}d`, due: false } // 'ok' — not surfaced to the plan
}

// Selection: on-grid = not staged, not done today, not a recurring chore (ONGOING projects ARE
// included — they are placed tasks flagged so the planner can pace them); plus recurring chores that
// are overdue/due/soon; plus active habits.
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
    .map((t) => ({
      id: t.id, // ties emitted rocks back to the task (resolvePlanTaskIds)
      text: t.text,
      importance: Math.round((t.y ?? 0.5) * 100),
      urgency: Math.round((t.x ?? 0.5) * 100),
      due: t.due,
      dueInDays: daysUntilInTZ(t.due, timeZone, now),
      dueTime: t.due_time,
      size: toPlanSize(t.size),
      ongoing: t.ongoing ?? false,
    }))

  const recurringDue: { id: string; text: string; status: string }[] = []
  for (const t of tasks) {
    if (dormant(t)) continue // a paused chore sits out its pause too
    const s = recurringStatus(t.recurring, now)
    if (s && s.due) recurringDue.push({ id: t.id, text: t.text, status: s.label })
  }

  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(now)

  return {
    today: fmt({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    dayOfWeek: dayNameInTZ(timeZone, now),
    tasks: planTasks,
    recurringDue,
    habits: habits.filter((h) => h.active).map((h) => h.text),
  }
}
