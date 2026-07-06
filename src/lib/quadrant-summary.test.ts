import { describe, expect, it } from 'vitest'
import type { Task } from '../types/task'
import {
  summarizeQuadrants,
  moveToQuadrant,
  QUADRANT_ORDER,
  QUADRANT_CENTER,
} from './quadrant-summary'
import { quadrantMeta } from './quadrants'
import { resolveCollision } from './collision'

function makeTask(over: Partial<Task>): Task {
  return {
    id: 'id',
    user_id: 'u1',
    text: 'task',
    x: 0.5,
    y: 0.5,
    due: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    created_at: '2026-06-23T00:00:00Z',
    deleted_at: null,
    ...over,
  }
}

const TZ = { timeZone: 'UTC' }

describe('summarizeQuadrants', () => {
  it('buckets placed tasks into their quadrants with counts', () => {
    const { buckets } = summarizeQuadrants(
      [
        makeTask({ id: 'dn1', x: 0.9, y: 0.9 }),
        makeTask({ id: 'dn2', x: 0.6, y: 0.7 }),
        makeTask({ id: 'sc', x: 0.1, y: 0.9 }),
        makeTask({ id: 'er', x: 0.9, y: 0.1 }),
        makeTask({ id: 'sd', x: 0.1, y: 0.1 }),
      ],
      TZ,
    )
    expect(buckets['do-now'].count).toBe(2)
    expect(buckets.schedule.count).toBe(1)
    expect(buckets.errands.count).toBe(1)
    expect(buckets.someday.count).toBe(1)
  })

  it('picks the highest-scoring task as the quadrant dominant', () => {
    const { buckets } = summarizeQuadrants(
      [
        makeTask({ id: 'lo', text: 'lower', x: 0.55, y: 0.55 }),
        makeTask({ id: 'hi', text: 'higher', x: 0.99, y: 0.99 }),
      ],
      TZ,
    )
    expect(buckets['do-now'].dominant?.id).toBe('hi')
  })

  it('excludes staged and null-coord tasks (they carry no quadrant)', () => {
    const { buckets, maxCount } = summarizeQuadrants(
      [
        makeTask({ id: 'staged', x: null, y: null, staged: true }),
        makeTask({ id: 'nullcoord', x: null, y: null }),
      ],
      TZ,
    )
    expect(maxCount).toBe(0)
    for (const key of QUADRANT_ORDER) {
      expect(buckets[key].count).toBe(0)
      expect(buckets[key].dominant).toBeNull()
    }
  })

  it('reports maxCount as the largest bucket (density-bar denominator)', () => {
    const { maxCount } = summarizeQuadrants(
      [
        makeTask({ id: 'a', x: 0.9, y: 0.9 }),
        makeTask({ id: 'b', x: 0.8, y: 0.8 }),
        makeTask({ id: 'c', x: 0.7, y: 0.7 }),
        makeTask({ id: 'd', x: 0.1, y: 0.9 }),
      ],
      TZ,
    )
    expect(maxCount).toBe(3) // three Do Now vs one Schedule
  })

  it('leaves empty quadrants with a null dominant', () => {
    const { buckets } = summarizeQuadrants([makeTask({ id: 'dn', x: 0.9, y: 0.9 })], TZ)
    expect(buckets.someday.dominant).toBeNull()
    expect(buckets.someday.count).toBe(0)
  })

  it('each quadrant center resolves to that quadrant (defaults are in-band)', () => {
    for (const key of QUADRANT_ORDER) {
      const c = QUADRANT_CENTER[key]
      expect(quadrantMeta(c.x, c.y).key).toBe(key)
    }
  })
})

describe('moveToQuadrant', () => {
  it('lands the task in the destination quadrant', () => {
    const task = makeTask({ id: 'm', x: 0.9, y: 0.9 }) // currently Do Now
    for (const dest of QUADRANT_ORDER) {
      const { x, y } = moveToQuadrant(task, dest, [task])
      expect(quadrantMeta(x, y).key).toBe(dest)
    }
  })

  it('runs the collision spiral off the quadrant center so it never overlaps another card', () => {
    const task = makeTask({ id: 'm', x: 0.1, y: 0.1 }) // Someday
    // A blocker already sitting exactly on the Schedule center.
    const center = QUADRANT_CENTER.schedule
    const blocker = makeTask({ id: 'b', x: center.x, y: center.y })
    const result = moveToQuadrant(task, 'schedule', [task, blocker])

    // Matches resolveCollision run against the same inputs, and is NOT the raw (occupied) center.
    expect(result).toEqual(resolveCollision(center.x, center.y, [task, blocker], 'm'))
    expect(result).not.toEqual({ x: center.x, y: center.y })
    expect(quadrantMeta(result.x, result.y).key).toBe('schedule')
  })
})
