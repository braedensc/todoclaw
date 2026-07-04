// Verbatim visual constants for the priority grid, ported from EisenClaw
// (planning/EISENCLAW-LOGIC-TO-PORT.md §13, html:537-590). Kept in one place so the
// canvas, cards, and tray share a single source of truth.

import type { QuadrantKey } from '../../lib/quadrants'

/**
 * Floor for the desktop grid surface height (px) — GridCanvas grows past this with the
 * viewport (`clamp(640px, 78vh, 1000px)`) so the grid stays the dominant element on tall
 * desktop windows instead of sitting at a fixed size. Mobile keeps a fixed height via a
 * separate Tailwind class on the canvas.
 */
export const GRID_HEIGHT_DESKTOP = 640

/** Placed-card width (px). Single-card clusters render at this width too. */
export const CARD_WIDTH = 112

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
