// Verbatim visual constants for the priority grid, ported from EisenClaw
// (planning/EISENCLAW-LOGIC-TO-PORT.md §13, html:537-590). Kept in one place so the
// canvas, cards, and tray share a single source of truth.

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
 * Card border accent — EisenClaw colored every card by its bucket dot
 * (`getBucket(t.bucket).dot`, html:20-23/587). In its final state only the `oneoff` bucket
 * survives (dot `#c2693f` = the terracotta accent; `weekly`/`project` were migrated away —
 * see EISENCLAW-LOGIC-TO-PORT.md Discrepancy #8), so this is a uniform side/bottom accent,
 * not a per-task differentiator. The 3px top border still encodes quadrant / recurring status.
 */
export const BUCKET_DOT = '#c2693f'

/** Recurring `×N` badge appears once a recurring task has been completed this many times. */
export const RECURRING_BADGE_MIN_DONE = 3

/**
 * Quadrant background tints (html:542-545). Indexed by `quadrantMeta(x,y).key` so a card's
 * region and the canvas tint stay in lockstep. Note: on screen the grid is y-inverted
 * (top = high importance), so Schedule/Do-Now occupy the top, Someday/Errands the bottom.
 */
export const QUADRANT_TINT: Record<QuadrantKey, string> = {
  schedule: 'rgba(70,130,100,0.09)', // top-left
  'do-now': 'rgba(205,110,50,0.10)', // top-right
  someday: 'rgba(130,120,105,0.04)', // bottom-left
  errands: 'rgba(170,148,50,0.08)', // bottom-right
}

/** Graph-paper line color (html:548). Drawn as a 10×10 background-size gradient. */
export const GRIDLINE_COLOR = 'rgba(148,136,116,.12)'

/** Center axis (x=0.5 / y=0.5) line color (html:548). */
export const AXIS_COLOR = 'rgba(0,0,0,.11)'

/** Muted color for the URGENCY / IMPORTANCE edge axis labels (html:535-536). */
export const AXIS_LABEL_COLOR = '#a59c88'
