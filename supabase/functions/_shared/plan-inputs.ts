// plan-inputs.ts — build the Plan My Day request from RAW task/habit rows, SERVER-SIDE. The
// client normally assembles this from src/lib (scoring + recurring); BabyClaw's generate_plan tool
// runs the plan without a client round-trip, so the same selection + date math is ported here.
// Faithful to src/features/ai/use-plan-my-day.ts buildPlanRequest + src/lib recurringStatus/daysUntil.

import { localDateInTZ } from './dates.ts'
import type { PlanRequest } from './plan-prompt.ts'

const MS_PER_DAY = 86_400_000

interface TaskRow {
  id: string
  text: string
  x: number | null
  y: number | null
  due: string | null
  staged: boolean
  recurring: { frequencyDays: number; lastDoneAt: string | null; doneCount: number } | null
}
interface HabitRow {
  text: string
  active: boolean
}

// Whole-number calendar-day difference between `due` and now, both collapsed to a date in the
// user's timezone (DST-safe, time-of-day independent). Mirrors src/lib/scoring.ts daysUntil.
function daysUntil(due: string | null, timeZone: string, now: Date): number | null {
  if (!due) return null
  const dueDay = Date.parse(`${localDateInTZ(timeZone, new Date(due))}T00:00:00Z`) / MS_PER_DAY
  const nowDay = Date.parse(`${localDateInTZ(timeZone, now)}T00:00:00Z`) / MS_PER_DAY
  return Math.round(dueDay - nowDay)
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

// Selection mirrors EisenClaw's planMyDay: on-grid = not staged, not done today, not recurring;
// plus recurring chores that are overdue/due/soon; plus active habits.
export function buildPlanRequest(
  tasks: TaskRow[],
  habits: HabitRow[],
  doneMap: Record<string, boolean>,
  timeZone: string,
  now: Date,
): PlanRequest {
  const planTasks = tasks
    .filter((t) => !t.staged && !doneMap[t.id] && !t.recurring && t.x != null && t.y != null)
    .map((t) => ({
      text: t.text,
      importance: Math.round((t.y ?? 0.5) * 100),
      urgency: Math.round((t.x ?? 0.5) * 100),
      due: t.due,
      dueInDays: daysUntil(t.due, timeZone, now),
    }))

  const recurringDue: { text: string; status: string }[] = []
  for (const t of tasks) {
    const s = recurringStatus(t.recurring, now)
    if (s && s.due) recurringDue.push({ text: t.text, status: s.label })
  }

  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(now)

  return {
    today: fmt({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    dayOfWeek: fmt({ weekday: 'long' }),
    tasks: planTasks,
    recurringDue,
    habits: habits.filter((h) => h.active).map((h) => h.text),
  }
}
