import type { Habit, Subtask } from '../../types/habit'

// Pure helpers over a habit's embedded subtasks (steps) array and the daily_state composite
// key. Kept separate from the data hooks (use-habits.ts) so component tests can mock the hooks
// without having to re-export this logic — HabitRow uses the REAL helpers here.

// daily_state.subtask_done is keyed by the composite "habitId:subtaskId". Single source of
// truth for that format so the writer (toggle) and reader (checkbox state) never drift.
export function subtaskKey(habitId: string, subtaskId: string): string {
  return `${habitId}:${subtaskId}`
}

// One set_daily_flag write (sans timezone — the caller supplies that at mutate time).
export interface DailyFlagWrite {
  map: 'habit_done' | 'subtask_done'
  key: string
  value: boolean
}

// The habit checkbox is a MASTER SWITCH for the whole habit today: checking it also checks every
// step, and unchecking clears every step (symmetric, so an accidental check fully undoes itself
// — individual steps stay independently toggleable for partial progress). Returns the full write
// list for the caller to fan out through useToggleDailyFlag: each write is its own atomic
// server-side merge (set_daily_flag), so no read-modify-write of the jsonb maps is introduced,
// and re-setting an already-set key is a harmless no-op merge.
export function habitDayWrites(habit: Habit, checked: boolean): DailyFlagWrite[] {
  return [
    { map: 'habit_done', key: habit.id, value: checked },
    ...habit.subtasks.map(
      (s): DailyFlagWrite => ({
        map: 'subtask_done',
        key: subtaskKey(habit.id, s.id),
        value: checked,
      }),
    ),
  ]
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
