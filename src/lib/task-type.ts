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

/** What the primary ✓ control does, which differs per task type. */
export type PrimaryDoneAction = 'archive' | 'recurring-cycle' | 'work-session'

/**
 * What the everyday ✓ means for a task. Every surface that renders a done control routes through
 * this, so the three arms can never drift apart across use-grid, ListView and the chat capability
 * layer (they previously each carried their own copy of the recurring branch).
 *
 * - `archive` — a one-off: goes to the Done tab + history and leaves the board for good.
 * - `recurring-cycle` — a chore: resets its clock (lastDoneAt/doneCount), never archives.
 * - `work-session` — an ONGOING project: logs that you put time in today. It does NOT archive; an
 *   ongoing project is finished deliberately, via "Finish project" in the schedule panel. Before
 *   2026-07-28 ongoing projects fell through to `archive`, so the everyday ✓ silently ended them —
 *   there was no way to record progress short of completion.
 */
export function primaryDoneAction(task: Pick<Task, 'recurring' | 'ongoing'>): PrimaryDoneAction {
  switch (taskType(task)) {
    case 'recurring':
      return 'recurring-cycle'
    case 'ongoing':
      return 'work-session'
    default:
      return 'archive'
  }
}
