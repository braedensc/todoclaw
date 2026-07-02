// Visual urgency: the "warmth = the data" layer on task cards. Ported verbatim from EisenClaw
// (planning/EISENCLAW-LOGIC-TO-PORT.md §4/§5, html:77-95; the pulse keyframe html:912-915 lives
// in src/index.css). Two independent, purely visual signals — kept here so the exact thresholds
// and color math live in ONE tested place; the grid card + cluster bubble only consume the result:
//   - urgencyGlowStyle(d): a box-shadow ring that intensifies as a due date approaches; overdue
//     items additionally pulse (the `urgency-pulse` keyframe).
//   - stalenessStyle(task): desaturates + fades a card that has sat untouched for weeks.
//
// Both are applied only to non-done, non-recurring cards by the caller (a recurring task carries
// its own RC_COLOR status badge; a done task has left the grid). `daysUntil` (scoring.ts) is
// timezone-aware; staleness is elapsed-real-time (created_at → now), timezone-independent —
// matching EisenClaw's `daysSince`.

const MS_PER_DAY = 86_400_000

/**
 * Due-badge / due-chip background (html:590): terracotta when the task is due within 2 days,
 * muted grey otherwise. Single source shared by the grid card's due badge (GridCard) and the
 * cluster popup's due chip (ClusterPopup) so the two never drift.
 */
export const DUE_BADGE_URGENT = '#c2693f' // = accent
export const DUE_BADGE_MUTED = '#8a8577'

/** Extra box-shadow (and, when overdue, a pulse animation) merged into a card/bubble's style. */
export interface GlowStyle {
  boxShadow: string
  /** Present only for overdue items — references the `urgency-pulse` keyframe (src/index.css). */
  animation?: string
}

/**
 * Box-shadow "glow" by days-until-due `d` (from `daysUntil`, so `null` = no due date). Tiers and
 * the exact rgba/px are verbatim from EisenClaw (html:77-85):
 *
 * | `d`      | effect                                    |
 * |----------|-------------------------------------------|
 * | `< 0`    | strongest ring + 14px glow + **pulse**    |
 * | `=== 0`  | ring + 12px glow                          |
 * | `<= 2`   | ring + 10px glow                          |
 * | `<= 7`   | ring + 8px glow                           |
 * | `<= 14`  | subtle 5px glow                           |
 * | else/null| none (`null`)                             |
 */
export function urgencyGlowStyle(d: number | null): GlowStyle | null {
  if (d === null) return null
  if (d < 0)
    return {
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 2px rgba(194,105,63,0.60), 0 0 14px 5px rgba(194,105,63,0.28)',
      animation: 'urgency-pulse 2s ease-in-out infinite',
    }
  if (d === 0)
    return {
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 1.5px rgba(194,105,63,0.50), 0 0 12px 4px rgba(194,105,63,0.20)',
    }
  if (d <= 2)
    return {
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 1.5px rgba(184,134,42,0.45), 0 0 10px 3px rgba(184,134,42,0.16)',
    }
  if (d <= 7)
    return {
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 1px rgba(138,120,40,0.28), 0 0 8px 2px rgba(138,120,40,0.10)',
    }
  if (d <= 14) return { boxShadow: '0 2px 7px rgba(0,0,0,.08), 0 0 5px 1px rgba(138,120,40,0.09)' }
  return null
}

/** Desaturation + opacity for a stale (long-untouched) card. */
export interface StalenessStyle {
  filter: string
  opacity: number
}

/** Whole days elapsed since an ISO timestamp (floor), or null if absent/unparseable. */
function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((now.getTime() - then) / MS_PER_DAY)
}

/**
 * Staleness "dust" by card age (`created_at` → now), verbatim from EisenClaw (html:88-95):
 *
 * | age      | filter / opacity            |
 * |----------|-----------------------------|
 * | staged   | none (`null`)               |
 * | `< 21d`  | none (`null`)               |
 * | `< 45d`  | `saturate(0.8)`,  opacity 0.90 |
 * | `< 75d`  | `saturate(0.55)`, opacity 0.82 |
 * | `>= 75d` | `saturate(0.3)`,  opacity 0.72 |
 *
 * A staged task (still in the tray) never desaturates — it hasn't been "left" on the grid yet.
 */
export function stalenessStyle(
  task: { created_at: string | null; staged: boolean },
  now: Date = new Date(),
): StalenessStyle | null {
  if (task.staged) return null
  const days = daysSince(task.created_at, now)
  if (days === null || days < 21) return null
  if (days < 45) return { filter: 'saturate(0.8)', opacity: 0.9 }
  if (days < 75) return { filter: 'saturate(0.55)', opacity: 0.82 }
  return { filter: 'saturate(0.3)', opacity: 0.72 }
}
