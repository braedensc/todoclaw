// Verbatim visual constants for cluster bubbles + popups, ported from EisenClaw
// (planning/EISENCLAW-LOGIC-TO-PORT.md §6, html:574-617). The clustering MATH (thresholds,
// dominant, accent) lives in src/lib/clustering.ts; these are purely presentational.

/** Cluster bubble diameter (px) — html:581. */
export const CLUSTER_BUBBLE_SIZE = 64

/** Per-ring offset (px) for the stacked depth shadow behind the bubble — html:577. */
export const CLUSTER_DEPTH_OFFSET = 4

/**
 * Pixel half-extent of a cluster bubble for the grid edge clamp (item 17) — the 64px body's 32px
 * radius plus a little slack for the faint depth rings that stack up-right behind it. Bubbles are
 * larger than cards, so they clamp by their own (wider) half-extent to stay fully inside the
 * `overflow-hidden` canvas.
 */
export const CLUSTER_BUBBLE_HALF = 36

/** Cluster popup width (px) — html:616. */
export const CLUSTER_POPUP_WIDTH = 220

/** Cluster popup max height (px) before it scrolls — html:616. */
export const CLUSTER_POPUP_MAX_HEIGHT = 320
