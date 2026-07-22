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
//   - staleness(task, d) + staleRingStyle / staleBadge / clusterStaleness: the COOL-BLUE
//     "stale" lane — a task that is clearly being IGNORED cools off. A dated task goes stale
//     once it's sat 3+ weeks past due (the 🔥 has stopped working); an undated task only after
//     months on the board (it may be a long-term idea). When stale, the card FLIPS lanes: the
//     hot dress (pulse, tint, 🔥, terracotta chip) is replaced wholesale by the cool one
//     (azure ring + icy tint + ❄️ + "Stale · Nd" chip) — the two never co-exist on one card.
//     A cluster bubble takes the ring of its most-stale member, mirroring how its glow takes
//     the nearest due.
//
// Glow/chips are applied only to non-done, non-recurring cards by the caller (a recurring task
// carries its own RC_COLOR status badge; a done task has left the grid). `daysUntil`
// (scoring.ts) and `minutesUntilDueTime` (dates.ts) are timezone-aware; the undated stale clock
// is elapsed-real-time from `created_at`. Priority SCORING is untouched by all of this — display
// only.

import { formatDueTime } from './dates'
import { daysUntil, type ScoringOpts } from './scoring'
import { formatStartDay } from './start-date'

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
 * The cool stale card treatment — a box-shadow ring plus a faint cool-blue card TINT, the
 * cold-side mirror of the warm urgency tint (`GlowStyle.background`). Composed by the caller
 * exactly like a glow: ring appended after the base shadow, tint replacing the paper fill. A
 * stale card never wears the warm dress at the same time (staleness gates the tier to 'none').
 */
export interface StaleRingStyle {
  boxShadow: string
  /** Cool-blue paper tint replacing the plain card fill, graduating icier with staleness depth. */
  background?: string
}

/**
 * Cool-blue rgb triplet for the stale lane — a deliberately COOL hue with no overlap with the
 * warm urgency ladder (terracotta / gold / olive), so "gone cold" and "due soon" read as two
 * different things across the board. A confident azure (distinct from the muted `puppy` brand
 * blue, which is reserved for BabyClaw / habits). Reused across the ring + halo alphas.
 */
const STALE_BLUE = '50,118,205'

/**
 * A DATED task goes stale this many days PAST DUE — the point where the 🔥 has clearly stopped
 * working and the task is being ignored, so the hot dress flips to the cool one. Inherits the
 * 21-day floor the created-age treatment used (owner spec 2026-07-13: "Stale (21d)").
 */
export const STALE_OVERDUE_FLOOR_DAYS = 21

/**
 * An UNDATED task goes stale this many days after `created_at`. Deliberately much longer than
 * the overdue floor: a task with no due date may be a long-term idea, not an ignored commitment,
 * so it earns months on the board before it starts reading cold (owner spec 2026-07-13).
 */
export const STALE_UNDATED_FLOOR_DAYS = 90

/** Whole days elapsed since an ISO timestamp (floor), or null if absent/unparseable. */
function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((now.getTime() - then) / MS_PER_DAY)
}

/**
 * One task's staleness — the single decision the whole cool lane (ring, tint, ❄️ badge, corner
 * flag) keys off, so a card flips to the cold dress all at once or not at all.
 */
export interface StaleInfo {
  /** The stale AMOUNT: days past due (dated) or days since created (undated). */
  days: number
  /** True when measured from the due date (an ignored deadline) vs created_at (an idea gone cold). */
  overdue: boolean
  /** The floor that tripped — `days / floor` is the staleness DEPTH driving the ring ladder. */
  floor: number
}

/**
 * The one staleness decision. `daysUntilDue` is the caller's timezone-aware `daysUntil` value
 * (null = no due date) — the same input `urgencyTier` takes, so the two lanes can never disagree
 * about what "past due" means:
 *
 *   - dated + >= 21d past due  → stale, measured from the due date (the 🔥 flips to ❄️)
 *   - undated + >= 90d on the board → stale, measured from `created_at`
 *   - future-dated, recently overdue, staged, or unparseable → not stale (null)
 *
 * A staged task never goes stale (it hasn't been "left on the board" yet); the recurring gate (a
 * chore carries its own status clock) stays with the caller, as it does for the warm lane.
 */
export function staleness(
  task: { created_at: string | null; staged: boolean; start_date?: string | null },
  daysUntilDue: number | null,
  now: Date = new Date(),
): StaleInfo | null {
  if (task.staged) return null
  // Stale means IGNORED — and dormant time (a paused task's future start_date) isn't ignoring.
  // Days since the start date, via the same UTC-noon projection the calendar cells use (hour-level
  // precision is immaterial against 21/90-day floors). Negative while still dormant, so a dormant
  // task can never read stale; small after a wake, so a fresh comeback isn't instantly ❄️.
  const sinceStart = task.start_date
    ? daysSince(`${task.start_date.slice(0, 10)}T12:00:00Z`, now)
    : null
  if (daysUntilDue !== null) {
    const past = -daysUntilDue
    if (past < STALE_OVERDUE_FLOOR_DAYS) return null
    // Recently (re)started: the user scheduled this comeback, so give it a full floor's worth of
    // actual board time before the overdue count reads as neglect again.
    if (sinceStart !== null && sinceStart < STALE_OVERDUE_FLOOR_DAYS) return null
    return { days: past, overdue: true, floor: STALE_OVERDUE_FLOOR_DAYS }
  }
  const created = daysSince(task.created_at, now)
  if (created === null) return null
  // Undated: board time counts from the LATER of created_at / start_date (min of the two ages).
  const days = sinceStart !== null ? Math.min(created, sinceStart) : created
  if (days < STALE_UNDATED_FLOOR_DAYS) return null
  return { days, overdue: false, floor: STALE_UNDATED_FLOOR_DAYS }
}

/**
 * The cool ring + icy tint for a staleness, deepening with DEPTH (`days / floor`) so both kinds
 * ramp on the same ladder: a dated task at 3/6/9 weeks past due hits the same rungs an undated
 * one hits at 3/6/9 months on the board. Ring/halo/tint values carry over unchanged from the
 * retired created-age ladder (pushed louder than a same-rung warm tier, owner ask 2026-07-12);
 * the loudest rung still sits just under the overdue ring.
 *
 * | depth        | ring + halo                   | tint       |
 * |--------------|-------------------------------|------------|
 * | not stale    | none (`null`)                 | —          |
 * | `< 2×` floor | 2px ring + 14px haze          | `#f3f8fd`  |
 * | `< 3×` floor | 2.5px ring + 20px haze        | `#eaf3fc`  |
 * | `>= 3×`      | 3px ring + brighter 28px haze | `#e0edfb`  |
 */
export function staleRingStyle(stale: StaleInfo | null): StaleRingStyle | null {
  if (!stale) return null
  const depth = stale.days / stale.floor
  if (depth < 2)
    return {
      boxShadow: `0 0 0 2px rgba(${STALE_BLUE},0.6), 0 0 14px 3px rgba(${STALE_BLUE},0.3)`,
      background: '#f3f8fd',
    }
  if (depth < 3)
    return {
      boxShadow: `0 0 0 2.5px rgba(${STALE_BLUE},0.78), 0 0 20px 5px rgba(${STALE_BLUE},0.42)`,
      background: '#eaf3fc',
    }
  return {
    boxShadow: `0 0 0 3px rgba(${STALE_BLUE},0.95), 0 0 28px 7px rgba(${STALE_BLUE},0.55)`,
    background: '#e0edfb',
  }
}

/**
 * The staleness of a CLUSTER — its DEEPEST-stale (highest `days / floor`) non-recurring member,
 * so a bubble adopts the coldest task's treatment the same way its urgency glow adopts the
 * nearest due date. Depth (not raw days) is compared so a task 9 weeks past due out-cools an
 * undated 4-month-old idea. Recurring members carry their own status color and are skipped;
 * clustered cards are placed (never staged). `null` when no member is stale.
 */
export function clusterStaleness(
  group: ReadonlyArray<{
    created_at: string | null
    staged: boolean
    due: string | null
    recurring: unknown
    start_date?: string | null
  }>,
  opts: ScoringOpts,
  now: Date = new Date(),
): StaleInfo | null {
  let deepest: StaleInfo | null = null
  for (const t of group) {
    if (t.recurring) continue
    const s = staleness(t, daysUntil(t.due, opts), now)
    if (!s) continue
    if (!deepest || s.days / s.floor > deepest.days / deepest.floor) deepest = s
  }
  return deepest
}

/**
 * Compact human amount for the ❄️ stale chip: days up to a month (so the chip reads "Stale · 21d"
 * right at the overdue floor), then weeks, months, years. The undated lane enters at 90d, so it
 * always lands on months or coarser.
 */
export function fmtAge(days: number): string {
  if (days < 30) return `${days}d`
  if (days < 70) return `${Math.round(days / 7)}w`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365)}y`
}

/**
 * The ❄️ stale badge — what a card wears INSTEAD of the hot dress once it's gone cold. It fills
 * two slots at once: the corner flag (❄️ replacing the 🔥, `title` as its hover text) and the
 * chip (`chip` replacing the terracotta "Overdue · Nd"), so callers render one badge, two ways.
 * Keyed off the SAME `staleness` as the ring/tint — one cool lane, all or nothing. Null when not
 * stale; the recurring gate is the caller's, exactly as with the ring.
 */
export interface StaleBadge {
  glyph: string
  /** Compact stale amount ("21d", "6w", "3mo") — the cluster rows' tiny-chip text. */
  amount: string
  /** Full chip text ("Stale · 21d") for the grid card + list row. */
  chip: string
  /** Spelled-out hover/aria text ("Stale — 21d past due" / "Stale — 3mo on the board"). */
  title: string
}

export function staleBadge(stale: StaleInfo | null): StaleBadge | null {
  if (!stale) return null
  const amount = fmtAge(stale.days)
  return {
    glyph: '❄️',
    amount,
    chip: `Stale · ${amount}`,
    title: stale.overdue ? `Stale — ${amount} past due` : `Stale — ${amount} on the board`,
  }
}

/**
 * Inline style for the ❄️ stale chip — the cold-lane mirror of the terracotta overdue chip
 * (`dueChipStyle('overdue')`): a solid azure fill in the same `STALE_BLUE` hue as the ring, so
 * the textual "how stale" badge reads as a sibling of the warm "how soon" badge without ever
 * being mistaken for it.
 */
export function staleChipStyle(): DueChipStyle {
  return { backgroundColor: `rgb(${STALE_BLUE})`, color: '#fff' }
}

/**
 * Slate rgb triplet for the PAUSED (dormant / future start_date) lane — a deliberately NEUTRAL,
 * cool-grey hue chosen to overlap NONE of the other card lanes: not the warm urgency ladder
 * (terracotta / gold / olive), not the cool STALE azure, and not the muted `puppy` brand blue
 * reserved for BabyClaw / habits. A paused task is a third thing entirely: it isn't due (its
 * deadline is intentionally deferred) and it isn't ignored (the user scheduled the wake) — it's
 * just SET ASIDE, waiting for its start date. Reused across the ring, tint, and chip.
 */
const PAUSED_SLATE = '100,116,139'

/**
 * Whole-card opacity a paused card is dimmed to. The set-aside cue that reads even where the slate
 * ring/chip can't be told apart from another lane: a paused card is visibly quieter than every
 * active/hot/stale card, which all render at full opacity. Kept legible (not a fade-out) so the
 * card is still readable and its ⋯ menu still usable (that's the Resume path).
 */
export const PAUSED_OPACITY = 0.62

/**
 * Ring + optional card tint for the paused lane — the same compose-into-`style` shape the warm
 * glow (`GlowStyle`) and the cool stale ring (`StaleRingStyle`) use: a box-shadow ring appended
 * after the base depth shadow, plus a tint replacing the plain paper fill.
 */
export interface PausedRingStyle {
  boxShadow: string
  background?: string
}

/**
 * The slate ring + faint slate tint a dormant card wears — the set-aside lane's mirror of
 * `staleRingStyle`. BINARY (no depth ladder like staleness): a task is paused or it isn't, so
 * there's a single, quiet treatment. Softer than the loud hot/stale rings — a paused card should
 * recede, not shout. Composed by the caller exactly like a glow/stale ring.
 */
export function pausedRingStyle(): PausedRingStyle {
  return {
    boxShadow: `0 0 0 2px rgba(${PAUSED_SLATE},0.55), 0 0 16px 4px rgba(${PAUSED_SLATE},0.20)`,
    background: '#f1f3f6',
  }
}

/**
 * Inline style for the solid slate ⏸ paused chip — the set-aside-lane mirror of the terracotta
 * due chip (`dueChipStyle('overdue')`) and the azure stale chip (`staleChipStyle`): the same
 * `PAUSED_SLATE` hue as the ring, so the "when it comes back" badge reads as a sibling of the
 * "how soon" / "how stale" badges without ever being mistaken for either.
 */
export function pausedChipStyle(): DueChipStyle {
  return { backgroundColor: `rgb(${PAUSED_SLATE})`, color: '#fff' }
}

/**
 * The ⏸ paused chip text — "⏸ starts Jul 30" (reuses `formatStartDay` so the day format matches
 * the SchedulePanel calendar and the Paused strip). A missing/unparseable start date falls back to
 * a bare "⏸ paused" (defensive — a dormant card always has a future start_date in practice).
 */
export function pausedChipLabel(startDate: string | null | undefined): string {
  const day = startDate ? formatStartDay(startDate) : ''
  return day ? `⏸ starts ${day}` : '⏸ paused'
}
