// Verbatim visual constants for the priority grid, ported from EisenClaw
// (planning/EISENCLAW-LOGIC-TO-PORT.md §13, html:537-590). Kept in one place so the
// canvas, cards, and tray share a single source of truth.

import type { QuadrantKey } from '../../lib/quadrants'

/** Grid surface height on desktop (px). Mobile shrinks via Tailwind class on the canvas. */
export const GRID_HEIGHT_DESKTOP = 640

/** Placed-card width (px). Single-card clusters render at this width too. */
export const CARD_WIDTH = 112

/** Recurring `×N` badge appears once a recurring task has been completed this many times. */
export const RECURRING_BADGE_MIN_DONE = 3

/**
 * Background for the non-recurring due-date badge (html:590): terracotta ("urgent") when the
 * task is due within 2 days, muted grey otherwise. This is the textual half of the urgency layer
 * (the glow is the visual half); recurring tasks show their RC_COLOR status badge instead.
 */
export const DUE_BADGE_URGENT = '#c2693f' // = accent
export const DUE_BADGE_MUTED = '#8a8577'

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
