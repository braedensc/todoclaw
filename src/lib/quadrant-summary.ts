import type { Task } from '../types/task'
import { quadrantMeta, type QuadrantKey } from './quadrants'
import { taskScore } from './scoring'
import { resolveCollision } from './collision'

// Per-quadrant rollup for the mobile overview (Concept C). The 2×2 minimap needs, for each
// Eisenhower quadrant: how many tasks sit there (count badge + density bar) and the single
// highest-priority one to preview ("what's on fire here"). Kept pure + in lib/ so it's unit-tested
// in isolation, like scoring/quadrants/collision — the component just renders what it returns.

/** Screen order of the quadrants, y-inverted to match the desktop grid: top row = high importance
 *  (Schedule left, Do Now right), bottom row = low importance (Someday left, Errands right). */
export const QUADRANT_ORDER: QuadrantKey[] = ['schedule', 'do-now', 'someday', 'errands']

/** One-line urgency×importance descriptor per quadrant — the overview cell caption and the
 *  move-picker subtitle, kept here so the two never drift. */
export const QUADRANT_SUBTITLE: Record<QuadrantKey, string> = {
  'do-now': 'Urgent · important',
  schedule: 'Important · not urgent',
  errands: 'Urgent · not important',
  someday: 'Not urgent · not important',
}

/** Band-center coordinate of each quadrant (data-space, x=urgency/y=importance). The default drop
 *  point when a task is created into / moved to a quadrant with no finer position — the collision
 *  spiral then settles the exact spot. Used by the overview and the upcoming move-to-quadrant flow. */
export const QUADRANT_CENTER: Record<QuadrantKey, { x: number; y: number }> = {
  'do-now': { x: 0.75, y: 0.75 },
  schedule: { x: 0.25, y: 0.75 },
  errands: { x: 0.75, y: 0.25 },
  someday: { x: 0.25, y: 0.25 },
}

export interface QuadrantSummary {
  count: number
  /** Highest-scoring task in the quadrant (the overview's preview line); null when empty. */
  dominant: Task | null
}

export interface QuadrantsOverview {
  buckets: Record<QuadrantKey, QuadrantSummary>
  /** Largest bucket count — the denominator for the relative density bars (0 when all empty). */
  maxCount: number
}

/**
 * Bucket PLACED tasks into their Eisenhower quadrants with a count and the dominant (top-score)
 * task each. Staged/unplaced tasks (null x/y) carry no real quadrant and are skipped — the mobile
 * overview surfaces those separately. Callers pass the already-active set (done-today removed).
 */
export function summarizeQuadrants(tasks: Task[], opts: { timeZone: string }): QuadrantsOverview {
  const buckets: Record<QuadrantKey, QuadrantSummary> = {
    'do-now': { count: 0, dominant: null },
    schedule: { count: 0, dominant: null },
    errands: { count: 0, dominant: null },
    someday: { count: 0, dominant: null },
  }

  for (const t of tasks) {
    if (t.staged || t.x == null || t.y == null) continue
    const bucket = buckets[quadrantMeta(t.x, t.y).key]
    bucket.count += 1
    if (bucket.dominant == null || taskScore(t, opts) > taskScore(bucket.dominant, opts)) {
      bucket.dominant = t
    }
  }

  const maxCount = Math.max(0, ...QUADRANT_ORDER.map((k) => buckets[k].count))
  return { buckets, maxCount }
}

/**
 * Coordinates for moving a task to a quadrant via the mobile tap picker (Concept C) — the no-drag
 * reposition path. Snaps to the destination quadrant's band center, then runs the existing
 * collision spiral (step 0.016, clamped) against all active tasks so it never lands on top of
 * another card. The quadrant carries the meaning on mobile; the spiral settles the exact spot,
 * exactly as a list slider commit does. Returns the resolved `{x, y}` for the caller to write.
 */
export function moveToQuadrant(
  task: Task,
  dest: QuadrantKey,
  allTasks: Task[],
): { x: number; y: number } {
  const center = QUADRANT_CENTER[dest]
  return resolveCollision(center.x, center.y, allTasks, task.id)
}
