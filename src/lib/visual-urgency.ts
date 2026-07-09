// Visual urgency: the "warmth = the data" layer on task cards. Originally ported verbatim from
// EisenClaw (planning/EISENCLAW-LOGIC-TO-PORT.md §4/§5); the glow ladder was then DELIBERATELY
// amplified (~2× ring alpha/spread) and extended with time-of-day tiers in the 2026-07-08
// due-times workshop — "much more obvious" was the explicit ask, so this is a considered
// departure from strict visual parity, not drift. The exact thresholds and color math live in
// ONE tested place; cards, cluster bubbles, list rows, and the grid legend only consume the
// result.
//
//   - urgencyTier(d, minutesUntil): the single tier decision — days-until-due plus, for tasks
//     with a due TIME, minutes until the exact instant (timed tasks go overdue when their
//     instant passes, not at midnight; the final two hours get their own tier).
//   - urgencyGlowStyle(tier): a box-shadow ring that intensifies tier by tier; overdue pulses
//     (urgency-pulse) and gets a warm card tint; the final hours pulse softly
//     (urgency-pulse-soft). Keyframes live in src/index.css with a reduced-motion kill-switch.
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
  /** Overdue only: a warm card tint replacing the plain white. */
  background?: string
}

const REST = '0 2px 7px rgba(0,0,0,.08)'

/**
 * Box-shadow "glow" by tier (2026-07-08 workshop ladder — ~2× the original EisenClaw alpha and
 * spread, one new rung):
 *
 * | tier          | effect                                        |
 * |---------------|-----------------------------------------------|
 * | `overdue`     | 2.5px ring + 24px glow + **pulse** + warm tint |
 * | `final-hours` | today's ring + **soft pulse**                 |
 * | `today`       | 2px terracotta ring + 18px glow               |
 * | `closing-in`  | 2px gold ring + 14px glow                     |
 * | `this-week`   | 1.5px olive ring + 11px glow                  |
 * | `radar`       | faint 7px olive haze                          |
 * | `none`        | none (`null`)                                 |
 */
export function urgencyGlowStyle(tier: UrgencyTier): GlowStyle | null {
  switch (tier) {
    case 'overdue':
      return {
        boxShadow: `${REST}, 0 0 0 2.5px rgba(194,105,63,0.90), 0 0 24px 9px rgba(194,105,63,0.42)`,
        animation: 'urgency-pulse 2s ease-in-out infinite',
        background: '#fff8f3',
      }
    case 'final-hours':
      return {
        boxShadow: `${REST}, 0 0 0 2px rgba(194,105,63,0.72), 0 0 18px 6px rgba(194,105,63,0.32)`,
        animation: 'urgency-pulse-soft 3s ease-in-out infinite',
      }
    case 'today':
      return {
        boxShadow: `${REST}, 0 0 0 2px rgba(194,105,63,0.72), 0 0 18px 6px rgba(194,105,63,0.32)`,
      }
    case 'closing-in':
      return {
        boxShadow: `${REST}, 0 0 0 2px rgba(184,134,42,0.62), 0 0 14px 5px rgba(184,134,42,0.26)`,
      }
    case 'this-week':
      return {
        boxShadow: `${REST}, 0 0 0 1.5px rgba(138,120,40,0.42), 0 0 11px 3px rgba(138,120,40,0.16)`,
      }
    case 'radar':
      return { boxShadow: `${REST}, 0 0 7px 2px rgba(138,120,40,0.14)` }
    case 'none':
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
