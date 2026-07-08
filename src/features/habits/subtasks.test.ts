import { describe, expect, it } from 'vitest'
import { subtaskKey, appendSubtask, removeSubtask, habitDayWrites } from './subtasks'
import type { Habit, Subtask } from '../../types/habit'

// Pure helpers behind the habits data layer (src/features/habits/subtasks.ts). The mutation
// hooks themselves are exercised via the HabitsView component test; here we lock down the pure
// logic the component relies on: the composite daily_state key + the immutable subtasks edits.

describe('subtaskKey', () => {
  it('builds the composite "habitId:subtaskId" key daily_state.subtask_done is keyed by', () => {
    expect(subtaskKey('h1', 's1')).toBe('h1:s1')
  })
})

describe('appendSubtask', () => {
  it('appends a new step with the given text and a generated id, without mutating the input', () => {
    const original: Subtask[] = [{ id: 's1', text: 'Rice bucket' }]
    const next = appendSubtask(original, 'Finger extensions')
    expect(next).toHaveLength(2)
    expect(next[1]!.text).toBe('Finger extensions')
    expect(next[1]!.id).toBeTruthy()
    expect(next[1]!.id).not.toBe('s1')
    expect(original).toHaveLength(1) // input untouched
  })
})

describe('removeSubtask', () => {
  it('removes the step with the matching id, without mutating the input', () => {
    const original: Subtask[] = [
      { id: 's1', text: 'Rice bucket' },
      { id: 's2', text: 'Finger extensions' },
    ]
    const next = removeSubtask(original, 's1')
    expect(next).toEqual([{ id: 's2', text: 'Finger extensions' }])
    expect(original).toHaveLength(2) // input untouched
  })

  it('returns an equivalent array when the id is not present', () => {
    const original: Subtask[] = [{ id: 's1', text: 'Rice bucket' }]
    expect(removeSubtask(original, 'nope')).toEqual(original)
  })
})

describe('habitDayWrites', () => {
  const habit: Habit = {
    id: 'h1',
    user_id: 'u1',
    text: 'Wrist routine',
    active: true,
    subtasks: [
      { id: 's1', text: 'Rice bucket' },
      { id: 's2', text: 'Finger extensions' },
    ],
    created_at: '2026-06-23T00:00:00.000Z',
    deleted_at: null,
  }

  it('checking a habit writes the habit flag AND every step flag (master switch)', () => {
    expect(habitDayWrites(habit, true)).toEqual([
      { map: 'habit_done', key: 'h1', value: true },
      { map: 'subtask_done', key: 'h1:s1', value: true },
      { map: 'subtask_done', key: 'h1:s2', value: true },
    ])
  })

  it('unchecking is symmetric — the habit flag and every step flag go false', () => {
    expect(habitDayWrites(habit, false)).toEqual([
      { map: 'habit_done', key: 'h1', value: false },
      { map: 'subtask_done', key: 'h1:s1', value: false },
      { map: 'subtask_done', key: 'h1:s2', value: false },
    ])
  })

  it('a habit with no steps writes only its own flag', () => {
    expect(habitDayWrites({ ...habit, subtasks: [] }, true)).toEqual([
      { map: 'habit_done', key: 'h1', value: true },
    ])
  })
})
