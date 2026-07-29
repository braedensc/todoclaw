import { describe, expect, it } from 'vitest'
import { ONGOING_GLYPH, primaryDoneAction, taskType } from './task-type'

// Every surface that renders a ✓ routes through primaryDoneAction, so these two functions are the
// only place the three task types are told apart. The arms used to be copy-pasted inline in
// use-grid, ListView and the chat capability layer, where they could (and did) drift.

const recurring = {
  recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 },
  ongoing: false,
}
const ongoing = { recurring: null, ongoing: true }
const plain = { recurring: null, ongoing: false }

describe('taskType', () => {
  it('names the three mutually exclusive types', () => {
    expect(taskType(recurring)).toBe('recurring')
    expect(taskType(ongoing)).toBe('ongoing')
    expect(taskType(plain)).toBe('task')
  })
})

describe('primaryDoneAction', () => {
  it('archives a one-off', () => {
    expect(primaryDoneAction(plain)).toBe('archive')
  })

  it('cycles a recurring chore instead of archiving it', () => {
    expect(primaryDoneAction(recurring)).toBe('recurring-cycle')
  })

  it('logs a work session on an ongoing project — it must NEVER archive', () => {
    // This is the whole point of the split. Until 2026-07-28 an ongoing project fell through to
    // 'archive', so the everyday ✓ silently ended a standing effort and there was no way to record
    // progress short of completion. Finishing an ongoing project is now a separate, deliberate,
    // confirm-gated action in the schedule panel.
    expect(primaryDoneAction(ongoing)).toBe('work-session')
    expect(primaryDoneAction(ongoing)).not.toBe('archive')
  })

  it('prefers the chore arm if a row ever carried both flags', () => {
    // tasks_type_exclusive_ck makes this unreachable in the database, but the function must still
    // be total — a mixed row from a stale cache or a restored backup gets a defined answer rather
    // than falling through to the destructive arm.
    expect(primaryDoneAction({ ...recurring, ongoing: true })).toBe('recurring-cycle')
  })
})

describe('ONGOING_GLYPH', () => {
  it('is the one source of truth for the badge', () => {
    expect(ONGOING_GLYPH).toBe('∞')
  })
})
