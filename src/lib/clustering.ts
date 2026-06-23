// Card clustering. Ported from EisenClaw `computeClusters` / `clusterDominant`
// (planning/EISENCLAW-LOGIC-TO-PORT.md §6, html:147-173).
//
// SEED-BASED, NON-TRANSITIVE: the original code comment (html:145-146) claims transitive
// grouping, but the implementation is non-transitive (Discrepancy #1) — the seed's
// neighbors do NOT become seeds, so moving a "bridge" card cannot cascade-regroup distant
// clusters. We port the implementation, not the comment.

import type { Task } from '../types/task'
import { quadrantMeta } from './quadrants'
import { RC_COLOR, recurringStatus } from './recurring'
import { taskScore, type ScoringOpts } from './scoring'

/** Cluster overlap thresholds (html:147). */
export const CX = 0.09
export const CY = 0.07

/**
 * Group tasks into seed-based, non-transitive clusters.
 *
 * Algorithm: copy tasks into a pool; while the pool is non-empty, pop a seed and form a
 * group of the seed plus every remaining pool task within `(cx, cy)` of it on both axes
 * (`|t.x - seed.x| < cx && |t.y - seed.y| < cy`); remove the joined tasks from the pool.
 * The seed's neighbors are NOT re-used as seeds — that is what makes it non-transitive.
 *
 * Tasks with a null `x` or `y` are not placed on the grid, so each becomes its own
 * singleton group (it can never match a seed and is never matched as a neighbor).
 *
 * The caller is responsible for filtering to grid-visible tasks; this function clusters
 * whatever it is given, preserving input order of seeds.
 */
export function computeClusters(tasks: Task[], cx: number = CX, cy: number = CY): Task[][] {
  const pool = [...tasks]
  const groups: Task[][] = []

  while (pool.length > 0) {
    const seed = pool.shift()
    if (seed === undefined) break // unreachable (length > 0), but satisfies the type checker
    const group: Task[] = [seed]

    // A seed with null coords cannot match anyone; it stays a singleton. Otherwise
    // partition the pool in input order: matches join the group, the rest stay pooled.
    if (seed.x != null && seed.y != null) {
      const sx = seed.x
      const sy = seed.y
      const remaining: Task[] = []
      for (const t of pool) {
        const matches =
          t.x != null && t.y != null && Math.abs(t.x - sx) < cx && Math.abs(t.y - sy) < cy
        if (matches) group.push(t)
        else remaining.push(t)
      }
      // Replace the pool contents in place; the seed's neighbors are NOT re-seeded.
      pool.length = 0
      pool.push(...remaining)
    }

    groups.push(group)
  }

  return groups
}

/**
 * The dominant task of a cluster — the one with the highest `taskScore` (html:167-173).
 * Ties resolve to the earliest task in the group.
 */
export function clusterDominant(group: Task[], opts: ScoringOpts): Task {
  const [first, ...rest] = group
  if (first === undefined) throw new Error('clusterDominant: empty group')
  let best = first
  let bestScore = taskScore(best, opts)
  for (const t of rest) {
    const s = taskScore(t, opts)
    if (s > bestScore) {
      best = t
      bestScore = s
    }
  }
  return best
}

/**
 * Accent color for a cluster: the dominant task's recurring-status color if it is a
 * recurring task, otherwise its quadrant color (html:167-173). Falls back to the quadrant
 * color of the grid center when the dominant has null coords.
 */
export function clusterAccentColor(group: Task[], opts: ScoringOpts): string {
  const dominant = clusterDominant(group, opts)
  const status = recurringStatus(dominant.recurring, opts)
  if (status) return RC_COLOR[status.code]
  return quadrantMeta(dominant.x ?? 0.5, dominant.y ?? 0.5).color
}
