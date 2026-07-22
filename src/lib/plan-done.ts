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
  const taskDone = (t: Task): boolean =>
    doneMap[t.id] === true || !!t.completed_at || recurringDoneToday(t.recurring, timeZone, now)

  if (rock.taskId) {
    if (doneMap[rock.taskId] === true) return true
    const byId = tasks.find((t) => t.id === rock.taskId)
    if (byId) return taskDone(byId)
    // Task row gone (deleted since planning) and not in the done map — fall through to text.
  }
  const text = rock.task.trim()
  if (!text) return false
  const byText = tasks.find((t) => t.text.trim() === text)
  return byText ? taskDone(byText) : false
}
