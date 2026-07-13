import type { Task } from '../types/task'

/** The three mutually-exclusive task types (2026-07-13). */
export type TaskType = 'task' | 'recurring' | 'ongoing'

/**
 * Which of the three types a task is. A task carrying `recurring` data is a repeating CHORE; one
 * with the `ongoing` flag set is an ONGOING project; otherwise it is a plain one-off TASK. Recurring
 * and ongoing are mutually exclusive — the tasks_type_exclusive_ck DB CHECK guarantees it — so
 * recurring is checked first and the two can never both be true on a real row.
 */
export function taskType(task: Pick<Task, 'recurring' | 'ongoing'>): TaskType {
  if (task.recurring) return 'recurring'
  if (task.ongoing) return 'ongoing'
  return 'task'
}

/** Glyph marking an ongoing project on cards/rows — one source of truth for the badge. */
export const ONGOING_GLYPH = '∞'
