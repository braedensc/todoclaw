import { describe, expect, it } from 'vitest'
import type { Task } from '../types/task'
import { FOOTPRINT_X, FOOTPRINT_Y, resolveCollision } from './collision'

function makeTask(
  id: string,
  x: number | null,
  y: number | null,
  overrides: Partial<Task> = {},
): Task {
  return {
    id,
    user_id: 'u',
    text: id,
    x,
    y,
    due: null,
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    ongoing: false,
    created_at: '2026-06-23T00:00:00Z',
    deleted_at: null,
    completed_at: null,
    start_date: null,
    ...overrides,
  }
}

// True iff two points are clear of each other's footprint (separated on either axis).
function isClear(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) >= FOOTPRINT_X || Math.abs(ay - by) >= FOOTPRINT_Y
}

describe('resolveCollision', () => {
  it('returns the target itself when the spot is clear', () => {
    const existing = makeTask('a', 0.1, 0.1)
    expect(resolveCollision(0.5, 0.5, [existing], 'self')).toEqual({ x: 0.5, y: 0.5 })
  })

  it('returns the target when the only nearby task is the excluded one', () => {
    const self = makeTask('self', 0.5, 0.5)
    expect(resolveCollision(0.5, 0.5, [self], 'self')).toEqual({ x: 0.5, y: 0.5 })
  })

  it('spirals out to a free neighbor when the target is blocked', () => {
    const blocker = makeTask('b', 0.5, 0.5)
    const result = resolveCollision(0.5, 0.5, [blocker], 'self')
    // The result must differ from the blocked target and be clear of the blocker.
    expect(result).not.toEqual({ x: 0.5, y: 0.5 })
    expect(isClear(result.x, result.y, 0.5, 0.5)).toBe(true)
  })

  it('clamps the result to [0.04, 0.96] on both axes', () => {
    // Target at the corner, blocked, so it must spiral; every candidate is clamped.
    const blocker = makeTask('b', 0.04, 0.04)
    const result = resolveCollision(0.04, 0.04, [blocker], 'self')
    expect(result.x).toBeGreaterThanOrEqual(0.04)
    expect(result.x).toBeLessThanOrEqual(0.96)
    expect(result.y).toBeGreaterThanOrEqual(0.04)
    expect(result.y).toBeLessThanOrEqual(0.96)
    expect(isClear(result.x, result.y, 0.04, 0.04)).toBe(true)
  })

  it('ignores staged, deleted, and ok-recurring tasks as blockers', () => {
    const staged = makeTask('staged', 0.5, 0.5, { staged: true })
    const deleted = makeTask('deleted', 0.5, 0.5, { deleted_at: '2026-06-20T00:00:00Z' })
    // ok-recurring: done today, long cadence → daysLeft large → code 'ok' → hidden.
    const okRecurring = makeTask('rec', 0.5, 0.5, {
      recurring: { frequencyDays: 30, lastDoneAt: '2026-06-23T00:00:00Z', doneCount: 1 },
    })
    const opts = { now: new Date('2026-06-23T12:00:00Z') }
    // None of these block, so the target is returned unchanged.
    expect(resolveCollision(0.5, 0.5, [staged, deleted, okRecurring], 'self', opts)).toEqual({
      x: 0.5,
      y: 0.5,
    })
  })

  it('treats a non-ok recurring task as a blocker', () => {
    // Never-done recurring → overdue (not ok) → still on the grid → blocks.
    const overdueRecurring = makeTask('rec', 0.5, 0.5, {
      recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 },
    })
    const result = resolveCollision(0.5, 0.5, [overdueRecurring], 'self', {
      now: new Date('2026-06-23T12:00:00Z'),
    })
    expect(result).not.toEqual({ x: 0.5, y: 0.5 })
  })
})
