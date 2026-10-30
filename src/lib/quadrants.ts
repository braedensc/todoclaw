// Eisenhower-matrix quadrant lookup. Ported from EisenClaw `quadrantMeta(x,y)`
// (planning/EISENCLAW-LOGIC-TO-PORT.md §1, html:36-42). Axes are DATA-space:
// x = urgency (0 left → 1 right), y = importance (0 bottom → 1 top). The grid renders
// y inverted (top = high importance), but that is a UI concern and not modeled here.
// Split at 0.5; the boundary value 0.5 belongs to the HIGH side (>=).

export type QuadrantKey = 'do-now' | 'schedule' | 'errands' | 'someday'

export interface QuadrantMeta {
  key: QuadrantKey
  label: string
  color: string
}

/**
 * The Eisenhower quadrant for a data-space coordinate `(x, y)`.
 *
 * - `x >= 0.5 && y >= 0.5` → Do Now   (urgent + important)
 * - `x <  0.5 && y >= 0.5` → Schedule (important, not urgent)
 * - `x >= 0.5 && y <  0.5` → Errands  (urgent, not important)
 * - otherwise              → Someday  (neither)
 *
 * Colors are the `--c-quadrant-*` palette tokens (src/index.css), whose light values are verbatim
 * from the EisenClaw source (html:36-42); as CSS-variable strings they follow the theme.
 */
export function quadrantMeta(x: number, y: number): QuadrantMeta {
  if (x >= 0.5 && y >= 0.5)
    return { key: 'do-now', label: 'Do Now', color: 'rgb(var(--c-quadrant-do-now))' }
  if (x < 0.5 && y >= 0.5)
    return { key: 'schedule', label: 'Schedule', color: 'rgb(var(--c-quadrant-schedule))' }
  if (x >= 0.5 && y < 0.5)
    return { key: 'errands', label: 'Errands', color: 'rgb(var(--c-quadrant-errands))' }
  return { key: 'someday', label: 'Someday', color: 'rgb(var(--c-quadrant-someday))' }
}
