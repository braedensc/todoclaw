import type { Subtask } from '../../types/habit'

// Pure helpers over a habit's embedded subtasks (steps) array and the daily_state composite
// key. Kept separate from the data hooks (use-habits.ts) so component tests can mock the hooks
// without having to re-export this logic — HabitRow uses the REAL helpers here.

// daily_state.subtask_done is keyed by the composite "habitId:subtaskId". Single source of
// truth for that format so the writer (toggle) and reader (checkbox state) never drift.
export function subtaskKey(habitId: string, subtaskId: string): string {
  return `${habitId}:${subtaskId}`
}

// Append a step to a habit's embedded subtasks array, returning a NEW array for an
// useUpdateHabit patch. The id is client-generated (subtasks have no table / DB default).
export function appendSubtask(subtasks: Subtask[], text: string): Subtask[] {
  return [...subtasks, { id: crypto.randomUUID(), text }]
}

// Remove a step from a habit's embedded subtasks array, returning a NEW array for an
// useUpdateHabit patch.
export function removeSubtask(subtasks: Subtask[], subtaskId: string): Subtask[] {
  return subtasks.filter((s) => s.id !== subtaskId)
}
