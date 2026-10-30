// Verbatim visual constants for the priority grid, ported from EisenClaw
// (planning/EISENCLAW-LOGIC-TO-PORT.md §13, html:537-590). Kept in one place so the
// canvas, cards, and tray share a single source of truth. Colors are theme tokens (`--c-*` in
// src/index.css, light values = the ported ones) so the dark class reaches these inline styles.

import type { QuadrantKey } from '../../lib/quadrants'

/** Placed-card width (px). Single-card clusters render at this width too. */
export const CARD_WIDTH = 112

/**
 * Pixel half-extents of a placed card, used to keep its whole bounding box inside the grid so
 * `overflow-hidden` can't clip a card near an edge (item 17). Width is exact (half of CARD_WIDTH);
 * height varies with content, so this is a representative half-height that covers a typical card
 * (a recurring card with its status badge is the tallest, ~100px) — erring toward a slightly larger
 * margin (a card pulled a few px in from the top/bottom edge) rather than a clipped one.
 */
export const CARD_HALF_WIDTH = CARD_WIDTH / 2
export const CARD_HALF_HEIGHT = 44

/**
 * Touch-chip extents (TouchGridSurface, the fullscreen touch grid). Chips are the phone/tablet
 * simplification of the 112px desktop card: one-line title + status chip. Same clamp math as
 * cards (boxClampBounds with these halves keeps a chip's whole box inside the surface). Height
 * is representative like CARD_HALF_HEIGHT — a chip with a status row runs ~44px tall.
 */
export const TOUCH_CHIP_WIDTH = 76
export const TOUCH_CHIP_HALF_WIDTH = TOUCH_CHIP_WIDTH / 2
export const TOUCH_CHIP_HALF_HEIGHT = 26

/**
 * Width a chip grows to WHILE lifted for a drag (press-and-hold). The resting chip's one-line
 * title is truncated; the lifted "ghost" widens to this and un-truncates so the full task is
 * legible under the finger during a reposition. Clamp math still uses the resting half-extents
 * (the enlarged box is a transient drag affordance, not a placement footprint).
 */
export const TOUCH_CHIP_LIFTED_WIDTH = 150

/**
 * Card border accent — EisenClaw colored every card by its bucket dot
 * (`getBucket(t.bucket).dot`, html:20-23/587). In its final state only the `oneoff` bucket
 * survives (its dot = the terracotta accent; `weekly`/`project` were migrated away —
 * see EISENCLAW-LOGIC-TO-PORT.md Discrepancy #8), so this is a uniform side/bottom accent,
 * not a per-task differentiator. The 3px top border still encodes quadrant / recurring status.
 */
export const BUCKET_DOT = 'rgb(var(--c-accent))'

/** Recurring `×N` badge appears once a recurring task has been completed this many times. */
export const RECURRING_BADGE_MIN_DONE = 3

/**
 * Quadrant background tints (html:542-545). Indexed by `quadrantMeta(x,y).key` so a card's
 * region and the canvas tint stay in lockstep. Note: on screen the grid is y-inverted
 * (top = high importance), so Schedule/Do-Now occupy the top, Someday/Errands the bottom.
 */
export const QUADRANT_TINT: Record<QuadrantKey, string> = {
  schedule: 'rgb(var(--c-quadrant-tint-schedule) / 0.09)', // top-left
  'do-now': 'rgb(var(--c-quadrant-tint-do-now) / 0.1)', // top-right
  someday: 'rgb(var(--c-quadrant-tint-someday) / 0.04)', // bottom-left
  errands: 'rgb(var(--c-quadrant-tint-errands) / 0.08)', // bottom-right
}

/** Graph-paper line color (html:548). Drawn as a 10×10 background-size gradient. */
export const GRIDLINE_COLOR = 'rgb(var(--c-gridline) / 0.12)'

/** Center axis (x=0.5 / y=0.5) line color (html:548). */
export const AXIS_COLOR = 'rgb(var(--c-axis) / 0.11)'

/** Muted color for the URGENCY / IMPORTANCE edge axis labels (html:535-536). */
export const AXIS_LABEL_COLOR = 'rgb(var(--c-axis-label))'
