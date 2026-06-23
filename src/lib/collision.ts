// Collision resolution. Ported from EisenClaw `resolveCollision`
// (planning/EISENCLAW-LOGIC-TO-PORT.md §7, html:126-142).
//
// Only called on list-view slider commit (NOT on grid drag, where overlap→cluster handles
// it — Discrepancy #4). Finds the nearest non-overlapping spot to a target via an outward
// spiral, clamped to the grid interior.

import type { Task } from '../types/task'
import { recurringStatus } from './recurring'

/** Card footprint half-extents for overlap testing (html:127). */
export const FOOTPRINT_X = 0.16
export const FOOTPRINT_Y = 0.115

// Spiral search parameters (html:134-137).
const R_START = 0.016
const R_END = 0.55
const R_STEP = 0.016
const A_STEP = Math.PI / 8
const CLAMP_MIN = 0.04
const CLAMP_MAX = 0.96

const clamp = (v: number): number => Math.min(CLAMP_MAX, Math.max(CLAMP_MIN, v))

export interface CollisionOpts {
  /** Injected for deterministic recurring-status checks; defaults to the current instant. */
  now?: Date
}

/**
 * Whether `(px, py)` overlaps any blocking task. A task blocks only if it is active
 * (not soft-deleted), not staged, not an `ok`-recurring task (those are hidden from the
 * grid), and not the task being moved (`excludeId`). Two cards overlap when they are
 * within the footprint on BOTH axes; they are clear if separated on EITHER axis.
 */
function overlapsAny(
  px: number,
  py: number,
  tasks: Task[],
  excludeId: string,
  opts: CollisionOpts,
): boolean {
  for (const t of tasks) {
    if (t.id === excludeId) continue
    if (t.deleted_at) continue
    if (t.staged) continue
    if (t.x == null || t.y == null) continue
    const status = recurringStatus(t.recurring, opts)
    if (status && status.code === 'ok') continue
    if (Math.abs(t.x - px) < FOOTPRINT_X && Math.abs(t.y - py) < FOOTPRINT_Y) {
      return true
    }
  }
  return false
}

/**
 * Resolve a target position to a non-overlapping spot near `(x, y)`.
 *
 * Tests the target itself first; if blocked, spirals outward (`r` from 0.016 to 0.55 in
 * 0.016 steps, angle `a` from 0 to 2π in π/8 steps) and returns the first free candidate,
 * with both axes clamped to `[0.04, 0.96]`. If nothing is free, returns the clamped target.
 */
export function resolveCollision(
  x: number,
  y: number,
  tasks: Task[],
  excludeId: string,
  opts: CollisionOpts = {},
): { x: number; y: number } {
  if (!overlapsAny(x, y, tasks, excludeId, opts)) {
    return { x: clamp(x), y: clamp(y) }
  }

  for (let r = R_START; r <= R_END; r += R_STEP) {
    for (let a = 0; a < Math.PI * 2; a += A_STEP) {
      const px = clamp(x + r * Math.cos(a))
      const py = clamp(y + r * Math.sin(a))
      if (!overlapsAny(px, py, tasks, excludeId, opts)) {
        return { x: px, y: py }
      }
    }
  }

  return { x: clamp(x), y: clamp(y) }
}
