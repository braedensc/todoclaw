import { describe, expect, it } from 'vitest'
import type { Task } from '../types/task'
import {
  clusterAccentColor,
  clusterDominant,
  clusterNearestDue,
  computeClusters,
  mergePreviewIds,
} from './clustering'

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
    ...overrides,
  }
}

const ids = (group: Task[]): string[] => group.map((t) => t.id)

describe('computeClusters', () => {
  it('groups two tasks within the (CX, CY) thresholds', () => {
    const a = makeTask('a', 0.5, 0.5)
    const b = makeTask('b', 0.55, 0.52) // within 0.09 / 0.07
    const groups = computeClusters([a, b])
    expect(groups).toHaveLength(1)
    expect(ids(groups[0]!).sort()).toEqual(['a', 'b'])
  })

  it('keeps a far task in its own group', () => {
    const a = makeTask('a', 0.2, 0.2)
    const b = makeTask('b', 0.8, 0.8)
    const groups = computeClusters([a, b])
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.length)).toEqual([1, 1])
  })

  it('is NON-transitive: A near B, B near C, A far from C, A is seed', () => {
    // A=(0.30) ... B=(0.38) within 0.09 of A ... C=(0.45) within 0.09 of B but 0.15 from A.
    const a = makeTask('a', 0.3, 0.5)
    const b = makeTask('b', 0.38, 0.5)
    const c = makeTask('c', 0.45, 0.5)
    const groups = computeClusters([a, b, c])
    // Seed A pulls in B (|0.38-0.30|=0.08 < 0.09). C is 0.15 from A → not pulled.
    // B is removed from the pool, so it can't seed C. C stands alone.
    expect(groups).toHaveLength(2)
    expect(ids(groups[0]!).sort()).toEqual(['a', 'b'])
    expect(ids(groups[1]!)).toEqual(['c'])
  })

  it('returns a singleton group for a lone task', () => {
    const a = makeTask('a', 0.5, 0.5)
    expect(computeClusters([a])).toEqual([[a]])
  })

  it('treats tasks with null coords as singletons', () => {
    const a = makeTask('a', null, null)
    const b = makeTask('b', 0.5, 0.5)
    const c = makeTask('c', 0.52, 0.5)
    const groups = computeClusters([a, b, c])
    // a is its own singleton (never matches); b and c cluster.
    expect(groups).toHaveLength(2)
    expect(ids(groups[0]!)).toEqual(['a'])
    expect(ids(groups[1]!).sort()).toEqual(['b', 'c'])
  })

  it('returns an empty array for no tasks', () => {
    expect(computeClusters([])).toEqual([])
  })
})

describe('mergePreviewIds', () => {
  const set = (...ids: string[]): Set<string> => new Set(ids)

  // The drag merge-preview must flag EXACTLY the cards a release would merge into. The oracle is
  // the drop itself: relocate the dragged card to the point (as the drop mutation does), cluster
  // the committed set, and read the dragged card's co-members. This is what byte-for-byte means.
  function dropOracle(
    placed: Parameters<typeof mergePreviewIds>[0],
    id: string,
    x: number,
    y: number,
  ) {
    const committed = placed.map((t) => (t.id === id ? { ...t, x, y } : t))
    const group = computeClusters(committed).find((g) => g.some((t) => t.id === id))
    const co = new Set<string>()
    if (group) for (const t of group) if (t.id !== id) co.add(t.id)
    return co
  }

  it('flags the single card a drop would merge into', () => {
    const d = makeTask('d', 0.9, 0.9)
    const a = makeTask('a', 0.5, 0.5)
    // Move d right onto a (dx 0.02, dy 0.01 — well within CX/CY).
    expect(mergePreviewIds([d, a], 'd', { x: 0.52, y: 0.51 })).toEqual(set('a'))
  })

  it('flags nothing on a near-miss — close, but outside the thresholds (no false positive)', () => {
    const d = makeTask('d', 0.9, 0.9)
    const a = makeTask('a', 0.5, 0.5)
    // dy 0.08 > CY 0.07 — visually near, but a release here would NOT merge.
    expect(mergePreviewIds([d, a], 'd', { x: 0.5, y: 0.58 })).toEqual(set())
    // dx 0.12 > CX 0.09 — same on the urgency axis.
    expect(mergePreviewIds([d, a], 'd', { x: 0.62, y: 0.5 })).toEqual(set())
  })

  it('flags EVERY member a drop absorbs when landing on a cluster (bubble), not just one', () => {
    const d = makeTask('d', 0.9, 0.9)
    const a = makeTask('a', 0.3, 0.5)
    const b = makeTask('b', 0.36, 0.5) // a+b already cluster (dx 0.06)
    // Drop d between them (dx 0.03 to each) → it merges with BOTH — the old nearest-single
    // heuristic would have flagged only one.
    expect(mergePreviewIds([d, a, b], 'd', { x: 0.33, y: 0.5 })).toEqual(set('a', 'b'))
  })

  it('respects seed order at a boundary — matches the committed set exactly, not a symmetric guess', () => {
    const d = makeTask('d', 0.9, 0.9)
    const a = makeTask('a', 0.3, 0.5)
    const b = makeTask('b', 0.38, 0.5) // a+b cluster (dx 0.08)
    // Point is within CX of b (0.08) but not a (0.16). The outcome hinges on who seeds first:
    // with d first, d seeds and pulls in b → merges {b}; with a first, a seeds and grabs b before
    // d is reached, leaving d alone → no merge. The preview mirrors whichever the drop would do.
    expect(mergePreviewIds([d, a, b], 'd', { x: 0.46, y: 0.5 })).toEqual(set('b'))
    expect(mergePreviewIds([a, b, d], 'd', { x: 0.46, y: 0.5 })).toEqual(set())
  })

  it('agrees with the on-drop computeClusters across the canvas (the byte-for-byte contract)', () => {
    const placed = [
      makeTask('d', 0.9, 0.9),
      makeTask('a', 0.3, 0.5),
      makeTask('b', 0.38, 0.5),
      makeTask('c', 0.7, 0.2),
    ]
    for (let x = 0.05; x < 0.96; x += 0.07) {
      for (let y = 0.05; y < 0.96; y += 0.07) {
        expect(mergePreviewIds(placed, 'd', { x, y })).toEqual(dropOracle(placed, 'd', x, y))
      }
    }
  })

  it('flags nothing when the dragged id is not on the grid (materialization in flight)', () => {
    const a = makeTask('a', 0.5, 0.5)
    expect(mergePreviewIds([a], 'ghost', { x: 0.5, y: 0.5 })).toEqual(set())
  })
})

describe('clusterDominant', () => {
  const opts = { timeZone: 'UTC', now: new Date('2026-06-23T12:00:00Z') }

  it('picks the highest-scoring task', () => {
    const low = makeTask('low', 0.1, 0.1)
    const high = makeTask('high', 0.9, 0.9)
    expect(clusterDominant([low, high], opts).id).toBe('high')
    expect(clusterDominant([high, low], opts).id).toBe('high')
  })

  it('resolves ties to the earliest task', () => {
    const a = makeTask('a', 0.5, 0.5)
    const b = makeTask('b', 0.5, 0.5)
    expect(clusterDominant([a, b], opts).id).toBe('a')
  })
})

describe('clusterAccentColor', () => {
  const opts = { timeZone: 'UTC', now: new Date('2026-06-23T12:00:00Z') }

  it('uses the dominant task quadrant color when not recurring', () => {
    // Dominant is high-urgency, high-importance → Do Now → #bf5e2a.
    const a = makeTask('a', 0.9, 0.9)
    const b = makeTask('b', 0.85, 0.88)
    expect(clusterAccentColor([a, b], opts)).toBe('#bf5e2a')
  })

  it('uses the recurring status color when the dominant is recurring', () => {
    // A recurring task never done → overdue → #c2693f. Make it dominant by score.
    const dominant = makeTask('rec', 0.9, 0.9, {
      recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 },
    })
    const other = makeTask('other', 0.85, 0.88)
    expect(clusterAccentColor([dominant, other], opts)).toBe('#c2693f')
  })
})

describe('clusterNearestDue', () => {
  const opts = { timeZone: 'UTC', now: new Date('2026-07-02T12:00:00Z') }

  it('returns the smallest daysUntil across the group', () => {
    const soon = makeTask('soon', 0.5, 0.5, { due: '2026-07-05' }) // +3
    const later = makeTask('later', 0.5, 0.5, { due: '2026-07-20' }) // +18
    expect(clusterNearestDue([later, soon], opts)).toBe(3)
  })

  it('returns a negative value when the nearest task is overdue', () => {
    const overdue = makeTask('od', 0.5, 0.5, { due: '2026-06-30' }) // -2
    const future = makeTask('fut', 0.5, 0.5, { due: '2026-07-10' }) // +8
    expect(clusterNearestDue([future, overdue], opts)).toBe(-2)
  })

  it('ignores recurring tasks (they carry their own status, not an urgency glow)', () => {
    const rec = makeTask('rec', 0.5, 0.5, {
      due: '2026-07-03',
      recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 },
    })
    const oneoff = makeTask('one', 0.5, 0.5, { due: '2026-07-09' }) // +7
    // The recurring task's earlier due date is skipped; the one-off wins.
    expect(clusterNearestDue([rec, oneoff], opts)).toBe(7)
  })

  it('returns null when no non-recurring member has a due date', () => {
    const a = makeTask('a', 0.5, 0.5, { due: null })
    const rec = makeTask('rec', 0.5, 0.5, {
      due: '2026-07-03',
      recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 },
    })
    expect(clusterNearestDue([a, rec], opts)).toBeNull()
  })

  it('ignores STALE members (>= 21d past due) — they flipped to the cool lane', () => {
    const stale = makeTask('stale', 0.5, 0.5, { due: '2026-06-11' }) // -21 → stale, skipped
    const future = makeTask('fut', 0.5, 0.5, { due: '2026-07-10' }) // +8 → wins
    expect(clusterNearestDue([stale, future], opts)).toBe(8)
    // A cluster of ONLY stale members has no warm glow at all.
    expect(clusterNearestDue([stale], opts)).toBeNull()
    // …but a merely-overdue member (under the floor) still reads hot.
    const overdue = makeTask('od', 0.5, 0.5, { due: '2026-06-12' }) // -20
    expect(clusterNearestDue([stale, overdue], opts)).toBe(-20)
  })
})
