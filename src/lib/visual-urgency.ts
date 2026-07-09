// Visual urgency: the "warmth = the data" layer on task cards. Originally ported verbatim from
// EisenClaw (planning/EISENCLAW-LOGIC-TO-PORT.md §4/§5); the glow ladder was then DELIBERATELY
// amplified and extended with time-of-day tiers in the 2026-07-08 due-times workshop, then pushed
// HARDER on 2026-07-09 (thicker/more-opaque rings that out-weight a card's own border, brighter
// halos) because "much more obvious / much stronger" was the standing, explicit ask — a considered
// departure from strict visual parity, not drift. That same pass added two channels that REINFORCE
// the hue-based glow instead of leaning on it alone: a graduated whole-card tint (survives a
// neighbour overlapping the ring) and a scarce 🔥 corner flag on the hot tiers (a color-independent
// cue). The exact thresholds and color math live in ONE tested place; cards, cluster bubbles, list
// rows, and the grid legend only consume the result.
//
//   - urgencyTier(d, minutesUntil): the single tier decision — days-until-due plus, for tasks
//     with a due TIME, minutes until the exact instant (timed tasks go overdue when their
//     instant passes, not at midnight; the final two hours get their own tier).
//   - urgencyGlowStyle(tier): a box-shadow ring that intensifies tier by tier, plus a graduated
//     warm card tint (background) on the warm tiers; overdue pulses (urgency-pulse), the final
//     hours pulse softly (urgency-pulse-soft). Keyframes live in src/index.css with a
//     reduced-motion kill-switch.
//   - urgencyIcon(tier): a scarce 🔥 corner flag on the hot tiers (overdue + due-today) — the
//     color-independent channel; null for the softer tiers.
//   - dueChipStyle(tier) / chip label helpers: the textual half, shared by the grid card,
//     cluster popup rows, and list rows so the surfaces never drift.
//   - stalenessStyle(task): desaturates + fades a card that has sat untouched for weeks
//     (unchanged EisenClaw parity).
//
// Glow/chips are applied only to non-done, non-recurring cards by the caller (a recurring task
// carries its own RC_COLOR status badge; a done task has left the grid). `daysUntil`
// (scoring.ts) and `minutesUntilDueTime` (dates.ts) are timezone-aware; staleness is
// elapsed-real-time. Priority SCORING is untouched by all of this — display only.

import { formatDueTime } from './dates'

const MS_PER_DAY = 86_400_000

/** Urgency hues (tailwind.config.js tokens): terracotta = accent, gold/olive = the softer tiers. */
export const DUE_BADGE_URGENT = '#c2693f' // = accent
export const DUE_BADGE_MUTED = '#8a8577'
const GOLD = '#b8862a'
const OLIVE = '#8a7828'

/** A timed task is "in the final hours" within this many minutes of its due instant. */
export const FINAL_HOURS_MINUTES = 120

export type UrgencyTier =
  | 'overdue'
  | 'final-hours'
  | 'today'
  | 'closing-in' // 1–2 days
  | 'this-week' // 3–7 days
  | 'radar' // 8–14 days
  | 'none'

/**
 * The one tier decision. `d` = calendar days until due (daysUntil; null = no due date);
 * `minutesUntil` = minutes until the exact due instant for tasks WITH a due time (negative =
 * past), null for date-only tasks. A timed task reads overdue once its instant passes (gated on
 * d <= 0 so a DST/midnight edge can't mark a future-dated task overdue); a date-only task only
 * at the day boundary, exactly as before.
 */
export function urgencyTier(d: number | null, minutesUntil: number | null): UrgencyTier {
  if (d === null) return 'none'
  if (d < 0) return 'overdue'
  if (d <= 0 && minutesUntil !== null && minutesUntil < 0) return 'overdue'
  if (d === 0 && minutesUntil !== null && minutesUntil <= FINAL_HOURS_MINUTES) return 'final-hours'
  if (d === 0) return 'today'
  if (d <= 2) return 'closing-in'
  if (d <= 7) return 'this-week'
  if (d <= 14) return 'radar'
  return 'none'
}

/** Extra box-shadow (+ pulse animation and warm tint at the loudest tiers) merged into a card/bubble's style. */
export interface GlowStyle {
  boxShadow: string
  /** References the urgency-pulse / urgency-pulse-soft keyframes (src/index.css). */
  animation?: string
  /**
   * A warm card tint replacing the plain paper fill — a whole-card fill channel that survives
   * even when a neighbour overlaps the ring. Graduated across the warm tiers (loudest = warmest),
   * absent on `radar`/`none`. Read by the grid card, the closed cluster bubble, and each
   * cluster-popup row so a clustered urgent task matches a standalone card.
   */
  background?: string
}

const REST = '0 2px 7px rgba(0,0,0,.08)'

/**
 * Box-shadow "glow" by tier. The 2026-07-08 workshop's ~2× ladder still read too faint next to a
 * card's own 1px border, so it was pushed HARDER on 2026-07-09 ("much stronger" was the explicit
 * ask): thicker, more opaque rings that clearly out-weight the border, plus a bigger, brighter
 * halo. The tier-to-tier gradient is preserved so nearer-due still reads louder.
 *
 * | tier          | ring + glow                          | card tint |
 * |---------------|--------------------------------------|-----------|
 * | `overdue`     | 4px solid ring + 32px glow + **pulse** | `#fff1e8` |
 * | `final-hours` | today's ring + **soft pulse**        | `#fff4ec` |
 * | `today`       | 3px terracotta ring + 26px glow      | `#fff7f0` |
 * | `closing-in`  | 3px gold ring + 22px glow            | `#fdf7ec` |
 * | `this-week`   | 2.5px olive ring + 18px glow         | `#faf7ee` |
 * | `radar`       | faint 1.5px olive ring + 14px haze   | —         |
 * | `none`        | none (`null`)                        | —         |
 */
export function urgencyGlowStyle(tier: UrgencyTier): GlowStyle | null {
  switch (tier) {
    case 'overdue':
      return {
        boxShadow: `${REST}, 0 0 0 4px rgba(194,105,63,1), 0 0 32px 12px rgba(194,105,63,0.6)`,
        animation: 'urgency-pulse 2s ease-in-out infinite',
        background: '#fff1e8',
      }
    case 'final-hours':
      return {
        boxShadow: `${REST}, 0 0 0 3px rgba(194,105,63,0.92), 0 0 26px 10px rgba(194,105,63,0.5)`,
        animation: 'urgency-pulse-soft 3s ease-in-out infinite',
        background: '#fff4ec',
      }
    case 'today':
      return {
        boxShadow: `${REST}, 0 0 0 3px rgba(194,105,63,0.92), 0 0 26px 10px rgba(194,105,63,0.5)`,
        background: '#fff7f0',
      }
    case 'closing-in':
      return {
        boxShadow: `${REST}, 0 0 0 3px rgba(184,134,42,0.8), 0 0 22px 8px rgba(184,134,42,0.42)`,
        background: '#fdf7ec',
      }
    case 'this-week':
      return {
        boxShadow: `${REST}, 0 0 0 2.5px rgba(138,120,40,0.6), 0 0 18px 6px rgba(138,120,40,0.3)`,
        background: '#faf7ee',
      }
    case 'radar':
      return {
        boxShadow: `${REST}, 0 0 0 1.5px rgba(138,120,40,0.35), 0 0 14px 4px rgba(138,120,40,0.22)`,
      }
    case 'none':
      return null
  }
}

/** A small 🔥 corner flag for the whole terracotta "hot" band (overdue + due-today) — a
 *  color-INDEPENDENT urgency cue that reads even where the hue-based glow/chip can't be told apart
 *  (colorblindness, glare). Deliberately ONE glyph and scarce: the softer tiers lean on the glow +
 *  tint + chip, so the flame itself means "act now." (We avoid ⏰ here — the chip already uses it
 *  for "has a set time", so reusing it on a date-only today card would overload the symbol.) The
 *  overdue/today split still reads in the chip text ("Overdue · 4d" vs "Today"). */
export interface UrgencyIcon {
  glyph: string
  label: string
}

export function urgencyIcon(tier: UrgencyTier): UrgencyIcon | null {
  switch (tier) {
    case 'overdue':
      return { glyph: '🔥', label: 'Overdue' }
    case 'final-hours':
    case 'today':
      return { glyph: '🔥', label: 'Due today' }
    default:
      return null
  }
}

/** Inline style for a due chip/badge, colored by tier (shared: grid card, cluster row, list row). */
export interface DueChipStyle {
  backgroundColor: string
  color: string
  border?: string
}

export function dueChipStyle(tier: UrgencyTier): DueChipStyle {
  switch (tier) {
    case 'overdue':
    case 'final-hours':
    case 'today':
      return { backgroundColor: DUE_BADGE_URGENT, color: '#fff' }
    case 'closing-in':
      return { backgroundColor: GOLD, color: '#fff' }
    case 'this-week':
      return {
        backgroundColor: 'transparent',
        color: OLIVE,
        border: '1.5px solid rgba(138,120,40,0.55)',
      }
    case 'radar':
    case 'none':
      return { backgroundColor: DUE_BADGE_MUTED, color: '#fff' }
  }
}

/** 'in 45m' / 'in 1h 20m' — the final-hours countdown. */
export function fmtCountdown(minutesUntil: number): string {
  const m = Math.max(1, Math.round(minutesUntil))
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `in ${h}h ${rem}m` : `in ${h}h`
}

/** The overdue AMOUNT: '2h' for a timed task past its instant today, else '3d'. */
export function fmtOverdueAmount(d: number, minutesUntil: number | null): string {
  if (d >= 0 && minutesUntil !== null && minutesUntil < 0) {
    const m = -minutesUntil
    return m < 60 ? `${Math.max(1, Math.round(m))}m` : `${Math.floor(m / 60)}h`
  }
  return `${Math.max(1, Math.abs(d))}d`
}

/**
 * The grid card's compact chip text by tier ("the chip finally says WHEN, not just how many
 * days" — workshop). Also used by tests to pin the ladder's wording.
 */
export function gridChipLabel(
  tier: UrgencyTier,
  d: number,
  dueTime: string | null,
  minutesUntil: number | null,
): string {
  switch (tier) {
    case 'overdue':
      return `Overdue · ${fmtOverdueAmount(d, minutesUntil)}`
    case 'final-hours':
      return `⏰ ${fmtCountdown(minutesUntil ?? 0)}`
    case 'today':
      return dueTime ? `⏰ ${formatDueTime(dueTime)}` : 'Today'
    case 'closing-in':
      if (d === 1) return dueTime ? `Tomorrow ${formatDueTime(dueTime)}` : 'Tomorrow'
      return `${d}d`
    default:
      return `${d}d`
  }
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
