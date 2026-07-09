import { describe, expect, it } from 'vitest'
import type { Task } from '../types/task'
import { daysUntil, taskScore } from './scoring'

// A minimal task factory — only the fields the scoring functions read matter.
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    user_id: 'u',
    text: 'task',
    x: 0.5,
    y: 0.5,
    due: null,
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    created_at: '2026-06-23T00:00:00Z',
    deleted_at: null,
    ...overrides,
  }
}

describe('daysUntil', () => {
  const now = new Date('2026-06-23T12:00:00Z')

  it('returns null when there is no due date', () => {
    expect(daysUntil(null, { timeZone: 'UTC', now })).toBeNull()
  })

  it('returns 0 for a due date that is today in the given timezone', () => {
    expect(daysUntil('2026-06-23T08:00:00Z', { timeZone: 'UTC', now })).toBe(0)
  })

  it('returns whole-day differences for future and past due dates', () => {
    expect(daysUntil('2026-06-24T00:00:00Z', { timeZone: 'UTC', now })).toBe(1)
    expect(daysUntil('2026-06-30T00:00:00Z', { timeZone: 'UTC', now })).toBe(7)
    expect(daysUntil('2026-06-21T00:00:00Z', { timeZone: 'UTC', now })).toBe(-2)
  })

  it('treats a bare date-only due as a floating calendar date, not a UTC instant', () => {
    // The date picker stores 'YYYY-MM-DD'. Parsed as a UTC instant it would be the previous local
    // day west of UTC, making a task overdue on its own due date. It must read as due today.
    const nyNow = new Date('2026-06-23T14:00:00Z') // 10am on the 23rd in New York
    expect(daysUntil('2026-06-23', { timeZone: 'America/New_York', now: nyNow })).toBe(0)
    expect(daysUntil('2026-06-24', { timeZone: 'America/New_York', now: nyNow })).toBe(1)
    // Overdue only the day AFTER the due date.
    expect(daysUntil('2026-06-22', { timeZone: 'America/New_York', now: nyNow })).toBe(-1)
    // Same floating date is due-today regardless of the user's zone.
    expect(daysUntil('2026-06-23', { timeZone: 'Asia/Tokyo', now: nyNow })).toBe(0)
  })

  it('evaluates both ends in the user timezone, not UTC', () => {
    // 03:30 UTC on the 23rd is still the 22nd in New York (UTC-4 in June), but the 23rd in
    // UTC. The due instant is midday on the 23rd (the 23rd in both zones). So in NY the diff
    // is 23rd − 22nd = 1 day; in UTC it is 23rd − 23rd = 0. Same inputs, different zones.
    const nyNow = new Date('2026-06-23T03:30:00Z')
    const due = '2026-06-23T12:00:00Z'
    expect(daysUntil(due, { timeZone: 'America/New_York', now: nyNow })).toBe(1)
    expect(daysUntil(due, { timeZone: 'UTC', now: nyNow })).toBe(0)
  })
})

describe('taskScore', () => {
  const now = new Date('2026-06-23T12:00:00Z')

  it('weights importance above urgency with no due bonus', () => {
    // x=1, y=1, no due → 1*0.45 + 1*0.55 = 1.0
    expect(taskScore(makeTask({ x: 1, y: 1, due: null }), { timeZone: 'UTC', now })).toBeCloseTo(
      1.0,
      10,
    )
    // x=1, y=0 → 0.45 ; x=0, y=1 → 0.55 (importance heavier).
    expect(taskScore(makeTask({ x: 1, y: 0, due: null }), { timeZone: 'UTC', now })).toBeCloseTo(
      0.45,
      10,
    )
    expect(taskScore(makeTask({ x: 0, y: 1, due: null }), { timeZone: 'UTC', now })).toBeCloseTo(
      0.55,
      10,
    )
  })

  it('adds a flat 0.18 bonus when due within 2 days', () => {
    // due tomorrow (1 day) → 1.0 + 0.18 = 1.18
    expect(
      taskScore(makeTask({ x: 1, y: 1, due: '2026-06-24T00:00:00Z' }), { timeZone: 'UTC', now }),
    ).toBeCloseTo(1.18, 10)
    // due in exactly 2 days → still bonus.
    expect(
      taskScore(makeTask({ x: 0, y: 0, due: '2026-06-25T00:00:00Z' }), { timeZone: 'UTC', now }),
    ).toBeCloseTo(0.18, 10)
  })

  it('does not add the bonus when due more than 2 days out', () => {
    // due in 3 days → no bonus.
    expect(
      taskScore(makeTask({ x: 0, y: 0, due: '2026-06-26T00:00:00Z' }), { timeZone: 'UTC', now }),
    ).toBeCloseTo(0, 10)
  })

  it('still adds the bonus for overdue tasks (daysUntil <= 2 includes negatives)', () => {
    expect(
      taskScore(makeTask({ x: 0, y: 0, due: '2026-06-20T00:00:00Z' }), { timeZone: 'UTC', now }),
    ).toBeCloseTo(0.18, 10)
  })

  it('treats null x or y as 0.5 and never produces NaN', () => {
    const score = taskScore(makeTask({ x: null, y: null, due: null }), { timeZone: 'UTC', now })
    // 0.5*0.45 + 0.5*0.55 = 0.5
    expect(score).toBeCloseTo(0.5, 10)
    expect(Number.isNaN(score)).toBe(false)

    const partial = taskScore(makeTask({ x: null, y: 1, due: null }), { timeZone: 'UTC', now })
    // 0.5*0.45 + 1*0.55 = 0.775
    expect(partial).toBeCloseTo(0.775, 10)
    expect(Number.isNaN(partial)).toBe(false)
  })
})
