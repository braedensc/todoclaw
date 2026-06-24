import { describe, expect, it } from 'vitest'
import { subtaskKey, appendSubtask, removeSubtask } from './subtasks'
import type { Subtask } from '../../types/habit'

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
