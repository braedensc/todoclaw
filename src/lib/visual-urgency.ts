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
//   - agingRingStyle(task) / clusterAgingRing(group): a COOL-BLUE box-shadow ring that
//     INTENSIFIES with a card's age — the inverse of EisenClaw's old fade. An old, undone task
//     should draw the eye, not recede; the ring's cool-blue hue keeps it in its own lane so it
//     never competes with the warm due-date glow (the two co-exist on one card). A cluster
//     bubble takes the ring of its most-aged member, mirroring how its glow takes the nearest due.
//
// Glow/chips are applied only to non-done, non-recurring cards by the caller (a recurring task
// carries its own RC_COLOR status badge; a done task has left the grid). `daysUntil`
// (scoring.ts) and `minutesUntilDueTime` (dates.ts) are timezone-aware; the aging ring is
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

/** The card's resting drop-shadow — the base depth layer that sits under every glow. Exported
 *  so GridCard can lay the cool aging ring over this same base when a card has no warm urgency
 *  glow (an inline box-shadow would otherwise clobber the card's resting `shadow-sm` class). */
export const BASE_CARD_SHADOW = '0 2px 7px rgba(0,0,0,.08)'

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
        boxShadow: `${BASE_CARD_SHADOW}, 0 0 0 4px rgba(194,105,63,1), 0 0 32px 12px rgba(194,105,63,0.6)`,
        animation: 'urgency-pulse 2s ease-in-out infinite',
        background: '#fff1e8',
      }
    case 'final-hours':
      return {
        boxShadow: `${BASE_CARD_SHADOW}, 0 0 0 3px rgba(194,105,63,0.92), 0 0 26px 10px rgba(194,105,63,0.5)`,
        animation: 'urgency-pulse-soft 3s ease-in-out infinite',
        background: '#fff4ec',
      }
    case 'today':
      return {
        boxShadow: `${BASE_CARD_SHADOW}, 0 0 0 3px rgba(194,105,63,0.92), 0 0 26px 10px rgba(194,105,63,0.5)`,
        background: '#fff7f0',
      }
    case 'closing-in':
      return {
        boxShadow: `${BASE_CARD_SHADOW}, 0 0 0 3px rgba(184,134,42,0.8), 0 0 22px 8px rgba(184,134,42,0.42)`,
        background: '#fdf7ec',
      }
    case 'this-week':
      return {
        boxShadow: `${BASE_CARD_SHADOW}, 0 0 0 2.5px rgba(138,120,40,0.6), 0 0 18px 6px rgba(138,120,40,0.3)`,
        background: '#faf7ee',
      }
    case 'radar':
      return {
        boxShadow: `${BASE_CARD_SHADOW}, 0 0 0 1.5px rgba(138,120,40,0.35), 0 0 14px 4px rgba(138,120,40,0.22)`,
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

/**
 * A cool aging card treatment — a box-shadow ring plus (on the older tiers) a faint cool-blue
 * card TINT, the cold-side mirror of the warm urgency tint (`GlowStyle.background`). Both are
 * meant to be COMPOSED by the caller: the ring appended after the warm glow's shadow, the tint
 * applied only when the warmer urgency tint is absent (a due deadline out-shouts staleness).
 */
export interface AgingRingStyle {
  boxShadow: string
  /** Cool-blue paper tint replacing the plain card fill, graduating icier with age (absent < 21d). */
  background?: string
}

/**
 * Cool-blue rgb triplet for the aging ring — a deliberately COOL hue with no overlap with the
 * warm urgency ladder (terracotta / gold / olive), so "old" and "due soon" read as two different
 * things even on the same card. A confident azure (distinct from the muted `puppy` brand blue,
 * which is reserved for BabyClaw / habits). Reused across the ring + halo alphas.
 */
const AGING_BLUE = '50,118,205'

/**
 * The age (whole days on the board) at/above which a card is "old enough" to wear the cool aging
 * treatment. The ring, the tint, AND the ❄️ badge all key off this ONE floor, so a card shows the
 * whole cool lane together or not at all. Same 21-day floor the retired EisenClaw fade used.
 */
export const AGING_FLOOR_DAYS = 21

/** Whole days elapsed since an ISO timestamp (floor), or null if absent/unparseable. */
function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((now.getTime() - then) / MS_PER_DAY)
}

/**
 * The aging treatment for a given card age in whole days — the tier ladder, shared by the per-card
 * `agingRingStyle` and the per-cluster `clusterAgingRing`. Cool-blue ring + halo that both grow
 * with age, plus (from the middle tier up) a faint cool-blue card TINT — the cold-side mirror of
 * the warm urgency tint, so the coldest cards read icy the way the hottest read warm. `null` under
 * the 21-day floor. The rings are pushed a touch louder than a same-rung warm tier (owner ask
 * 2026-07-12) so an old card genuinely stands out, while the loudest (months) sits just under the
 * overdue ring.
 *
 * | age      | ring + halo                   | tint       |
 * |----------|-------------------------------|------------|
 * | `< 21d`  | none (`null`)                 | —          |
 * | `< 45d`  | 2px ring + 14px haze          | `#f3f8fd`  |
 * | `< 75d`  | 2.5px ring + 20px haze        | `#eaf3fc`  |
 * | `>= 75d` | 3px ring + brighter 28px haze | `#e0edfb`  |
 */
function ringForAgeDays(days: number): AgingRingStyle | null {
  if (days < AGING_FLOOR_DAYS) return null
  if (days < 45)
    return {
      boxShadow: `0 0 0 2px rgba(${AGING_BLUE},0.6), 0 0 14px 3px rgba(${AGING_BLUE},0.3)`,
      background: '#f3f8fd',
    }
  if (days < 75)
    return {
      boxShadow: `0 0 0 2.5px rgba(${AGING_BLUE},0.78), 0 0 20px 5px rgba(${AGING_BLUE},0.42)`,
      background: '#eaf3fc',
    }
  return {
    boxShadow: `0 0 0 3px rgba(${AGING_BLUE},0.95), 0 0 28px 7px rgba(${AGING_BLUE},0.55)`,
    background: '#e0edfb',
  }
}

/**
 * The aging ring by card age (`created_at` → now) — the INVERSE of EisenClaw's old fade
 * (which desaturated + dimmed old cards into the background). An old, undone task is usually
 * one you're avoiding, so it should gain presence, not lose it: a cool-blue ring that grows
 * thicker + a brighter halo the longer the card has sat on the board.
 *
 * A staged task (still in the tray) never rings — it hasn't been "left on the board" yet. Age
 * breakpoints (21/45/75d) are carried over from the retired fade; an undated/unparseable card
 * gets none.
 */
export function agingRingStyle(
  task: { created_at: string | null; staged: boolean },
  now: Date = new Date(),
): AgingRingStyle | null {
  if (task.staged) return null
  const days = daysSince(task.created_at, now)
  if (days === null) return null
  return ringForAgeDays(days)
}

/**
 * The aging ring for a CLUSTER — the ring of its most-aged (oldest `created_at`) NON-recurring
 * member, so a bubble adopts the "hottest" task's treatment the same way its urgency glow adopts
 * the nearest due date (`clusterNearestDue`). Recurring members carry their own status color, not
 * an aging ring, and are skipped; clustered cards are placed (never staged). `null` when no member
 * is old enough (or none has a parseable `created_at`).
 */
export function clusterAgingRing(
  group: ReadonlyArray<{ created_at: string | null; recurring: unknown }>,
  now: Date = new Date(),
): AgingRingStyle | null {
  let oldest: number | null = null
  for (const t of group) {
    if (t.recurring) continue
    const d = daysSince(t.created_at, now)
    if (d === null) continue
    if (oldest === null || d > oldest) oldest = d
  }
  return oldest === null ? null : ringForAgeDays(oldest)
}

/**
 * Compact human age for the ❄️ aging chip: weeks, then months, then years. The days branch only
 * exists for completeness — the badge never renders below the aging floor (21d), so callers always
 * land on weeks or coarser.
 */
export function fmtAge(days: number): string {
  if (days < AGING_FLOOR_DAYS) return `${days}d`
  if (days < 70) return `${Math.round(days / 7)}w`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365)}y`
}

/**
 * The ❄️ aging badge — the cold-side mirror of the hot 🔥 flag (`urgencyIcon`). Where 🔥 means "act
 * now", ❄️ means "this has gone stale on the board" AND carries HOW long: `age` is the compact
 * "3w"/"5mo"/"1y" the chip renders, `label` the spelled-out aria text. Keyed off the SAME
 * `AGING_FLOOR_DAYS` as the aging ring/tint, so a card wears the ring, the tint, and this badge as
 * one cool lane. Returns null for a staged card (not yet "left on the board"), a fresh card, or an
 * unparseable created_at. The recurring gate (a chore carries its own status, not an age) is the
 * caller's — exactly as with the ring.
 */
export interface AgingBadge {
  glyph: string
  /** Compact age for the chip text ("3w", "5mo", "1y"). */
  age: string
  /** Spelled-out aria/title label ("3w on the board"). */
  label: string
}

export function agingBadge(
  task: { created_at: string | null; staged: boolean },
  now: Date = new Date(),
): AgingBadge | null {
  if (task.staged) return null
  const days = daysSince(task.created_at, now)
  if (days === null || days < AGING_FLOOR_DAYS) return null
  const age = fmtAge(days)
  return { glyph: '❄️', age, label: `${age} on the board` }
}

/**
 * Inline style for the ❄️ aging chip — the cold-lane mirror of the terracotta overdue chip
 * (`dueChipStyle('overdue')`): a solid azure fill in the same `AGING_BLUE` hue as the ring, so the
 * textual "how old" badge reads as a sibling of the warm "how soon" badge without ever being
 * mistaken for it.
 */
export function agingChipStyle(): DueChipStyle {
  return { backgroundColor: `rgb(${AGING_BLUE})`, color: '#fff' }
}
