import { recurringDoneToday } from './recurring'
import type { Task } from '../types/task'
import type { PlanRock } from '../types/plan'

// Is this Plan My Day rock's task already completed? Powers the plan card's strikethrough: a rock
// crosses itself off the moment its task is marked done anywhere (grid/list/mobile ✓, or BabyClaw's
// complete_task — either way the tasks/daily_state caches update and this re-evaluates).
//
// Matching mirrors the evening recap (supabase/functions/_shared/dispatch.ts buildRecapMessage):
//   1. by the rock's taskId (stamped at generation): today's done map, the task's permanent
//      completed_at, or — for a recurring chore — lastDoneAt landing on today (user-local day);
//   2. by exact task text as the fallback for legacy plans whose rocks predate taskId.
// A rock that matches nothing (model-invented item, task deleted since planning) just stays
// unstruck — never a false positive from fuzzy matching.
export function isPlanRockDone(
  rock: Pick<PlanRock, 'task' | 'taskId'>,
  tasks: Task[],
  doneMap: Record<string, boolean>,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  // A done-map hit on the rock's own id stands even when the task row is gone (completed, then
  // deleted) — findPlanTask can't match a row that no longer exists.
  if (rock.taskId && doneMap[rock.taskId] === true) return true
  const task = findPlanTask(rock, tasks)
  if (!task) return false
  return (
    doneMap[task.id] === true ||
    !!task.completed_at ||
    recurringDoneToday(task.recurring, timeZone, now)
  )
}

// The board task a plan item points at, or null when nothing matches (a model-invented item, or a
// task deleted since planning). Same match order isPlanRockDone strikes on — the stamped taskId
// first, exact task text only as the legacy fallback — so the plan card's checkbox always acts on
// the SAME row the strikethrough tracks; the two can never disagree about which task an item is.
export function findPlanTask(item: Pick<PlanRock, 'task' | 'taskId'>, tasks: Task[]): Task | null {
  if (item.taskId) {
    const byId = tasks.find((t) => t.id === item.taskId)
    // Task row gone (deleted since planning) — fall through to text.
    if (byId) return byId
  }
  const text = item.task.trim()
  if (!text) return null
  return tasks.find((t) => t.text.trim() === text) ?? null
}
