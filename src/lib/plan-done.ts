import { recurringDoneToday } from './recurring'
import { workRecency } from './worked'
import type { Task } from '../types/task'
import type { PlanRock } from '../types/plan'

// Is this Plan My Day rock's task already completed? Powers the plan card's strikethrough: a rock
// crosses itself off the moment its task is marked done anywhere (grid/list/mobile ✓, or BabyClaw's
// complete_task — either way the tasks/daily_state caches update and this re-evaluates).
//
// "Done" depends on the task's TYPE, because each one is finished by a different gesture: a one-off
// is archived, a recurring chore advances lastDoneAt, and an ONGOING project logs a work session —
// its ✓ never archives it, so a session is what completing it means for today.
//
// Matching mirrors the evening recap (supabase/functions/_shared/dispatch.ts recapPlanItems — the
// two must agree about what a completed rock is, or the card and the check-in contradict each other):
//   1. by the rock's taskId (stamped at generation): today's done map, the task's permanent
//      completed_at, lastDoneAt landing on today for a recurring chore, or a session logged today
//      for an ongoing project (all user-local days);
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
  // workRecency returns null for anything that is not an ongoing project, so the session arm is
  // inert for a chore or a one-off.
  const taskDone = (t: Task): boolean =>
    doneMap[t.id] === true ||
    !!t.completed_at ||
    recurringDoneToday(t.recurring, timeZone, now) ||
    workRecency(t, timeZone, now)?.workedToday === true

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
