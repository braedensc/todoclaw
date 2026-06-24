// Verbatim visual constants for cluster bubbles + popups, ported from EisenClaw
// (planning/EISENCLAW-LOGIC-TO-PORT.md §6, html:574-617). The clustering MATH (thresholds,
// dominant, accent) lives in src/lib/clustering.ts; these are purely presentational.

/** Cluster bubble diameter (px) — html:581. */
export const CLUSTER_BUBBLE_SIZE = 64

/** Per-ring offset (px) for the stacked depth shadow behind the bubble — html:577. */
export const CLUSTER_DEPTH_OFFSET = 4

/** Cluster popup width (px) — html:616. */
export const CLUSTER_POPUP_WIDTH = 220

/** Cluster popup max height (px) before it scrolls — html:616. */
export const CLUSTER_POPUP_MAX_HEIGHT = 320

/**
 * Popup flips ABOVE the bubble when the dominant task's DATA-space y (importance) exceeds
 * this — html:616-617. data-y > 0.55 means the bubble sits high on the (y-inverted) screen,
 * so EisenClaw anchors the panel above it. We replicate the source threshold exactly.
 */
export const CLUSTER_POPUP_FLIP_Y = 0.55
