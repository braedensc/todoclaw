import { describe, expect, it } from 'vitest'
import type { Task } from '../types/task'
import {
  summarizeQuadrants,
  moveToQuadrant,
  placeInQuadrant,
  isUnplaced,
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
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    ongoing: false,
    created_at: '2026-06-23T00:00:00Z',
    deleted_at: null,
    completed_at: null,
    start_date: null,
    ...over,
  }
}

const TZ = { timeZone: 'UTC' }

describe('isUnplaced', () => {
  it('flags staged or coord-less tasks; a placed task is not unplaced', () => {
    expect(isUnplaced(makeTask({ staged: true, x: null, y: null }))).toBe(true)
    // Belt-and-suspenders: either signal alone counts (staged with coords, or coords missing).
    expect(isUnplaced(makeTask({ staged: true }))).toBe(true)
    expect(isUnplaced(makeTask({ x: null, y: null }))).toBe(true)
    expect(isUnplaced(makeTask({}))).toBe(false)
  })
})

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

  it('orders the top preview list by score, highest first', () => {
    const { buckets } = summarizeQuadrants(
      [
        makeTask({ id: 'lo', text: 'lower', x: 0.55, y: 0.55 }),
        makeTask({ id: 'hi', text: 'higher', x: 0.99, y: 0.99 }),
      ],
      TZ,
    )
    expect(buckets['do-now'].top.map((t) => t.id)).toEqual(['hi', 'lo'])
  })

  it('caps the preview at QUADRANT_PREVIEW_COUNT but keeps the full count', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      makeTask({ id: `dn${i}`, x: 0.9, y: 0.6 + i * 0.05 }),
    )
    const { buckets } = summarizeQuadrants(many, TZ)
    expect(buckets['do-now'].count).toBe(5)
    expect(buckets['do-now'].top).toHaveLength(3)
  })

  it('excludes staged and null-coord tasks (they carry no quadrant)', () => {
    const { buckets } = summarizeQuadrants(
      [
        makeTask({ id: 'staged', x: null, y: null, staged: true }),
        makeTask({ id: 'nullcoord', x: null, y: null }),
      ],
      TZ,
    )
    for (const key of QUADRANT_ORDER) {
      expect(buckets[key].count).toBe(0)
      expect(buckets[key].top).toEqual([])
    }
  })

  it('leaves empty quadrants with an empty preview', () => {
    const { buckets } = summarizeQuadrants([makeTask({ id: 'dn', x: 0.9, y: 0.9 })], TZ)
    expect(buckets.someday.top).toEqual([])
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

describe('placeInQuadrant', () => {
  it('lands a new task in the destination quadrant, excluding nothing', () => {
    const existing = makeTask({ id: 'e', x: 0.9, y: 0.9 })
    for (const dest of QUADRANT_ORDER) {
      const { x, y } = placeInQuadrant(dest, [existing])
      expect(quadrantMeta(x, y).key).toBe(dest)
    }
  })

  it('spirals off an occupied quadrant center so the new task never overlaps', () => {
    const center = QUADRANT_CENTER['do-now']
    const blocker = makeTask({ id: 'b', x: center.x, y: center.y })
    const result = placeInQuadrant('do-now', [blocker])

    expect(result).toEqual(resolveCollision(center.x, center.y, [blocker], ''))
    expect(result).not.toEqual({ x: center.x, y: center.y })
    expect(quadrantMeta(result.x, result.y).key).toBe('do-now')
  })
})
