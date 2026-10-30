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
//     warm card tint (backgroundColor) on the warm tiers; overdue pulses (urgency-pulse), the final
//     hours pulse softly (urgency-pulse-soft). Keyframes live in src/index.css with a
//     reduced-motion kill-switch.
//   - urgencyIcon(tier): a scarce 🔥 corner flag on the hot tiers (overdue + due-today) — the
//     color-independent channel; null for the softer tiers.
//   - dueChipStyle(tier) / chip label helpers: the textual half, shared by the grid card,
//     cluster popup rows, and list rows so the surfaces never drift.
//   - staleness(task, d) + staleRingStyle / staleBadge / clusterStaleness: the COOL-BLUE
//     "stale" lane — a task that is clearly being IGNORED cools off. A dated task goes stale
//     once it's sat 3+ weeks past due (the 🔥 has stopped working); an undated task only after
//     months on the board (it may be a long-term idea). Evidence of ATTENTION — waking from a
//     pause, or a logged work session — restarts that clock in both lanes. When stale, the card
//     FLIPS lanes: the hot dress (pulse, tint, 🔥, terracotta chip) is replaced wholesale by the
//     cool one (azure ring + icy tint + ❄️ + "Stale · Nd" chip) — the two never co-exist on one
//     card. A cluster bubble takes the ring of its most-stale member, mirroring how its glow
//     takes the nearest due.
//
// Glow/chips are applied only to non-done, non-recurring cards by the caller (a recurring task
// carries its own RC_COLOR status badge; a done task has left the grid). `daysUntil`
// (scoring.ts) and `minutesUntilDueTime` (dates.ts) are timezone-aware; the undated stale clock
// is elapsed-real-time from the latest of `created_at` / `start_date` / the last logged session.
// Priority SCORING is untouched by all of this — display only.

import { formatDueTime } from './dates'
import { daysUntil, type ScoringOpts } from './scoring'
import { formatStartDay } from './start-date'

const MS_PER_DAY = 86_400_000

/**
 * The lane hues, as opaque theme-token colors (`--c-*` in src/index.css — light values are the
 * original hex, html.dark lifts them): terracotta = accent for the hot tiers, gold/olive for the
 * softer ones, azure for stale, slate for paused. Every inline color below is one of these, alone
 * or through `withAlpha`, so the dark class reaches the inline styles. Exported for GridLegend.
 */
export const URGENT_HUE = 'rgb(var(--c-accent))'
export const GOLD_HUE = 'rgb(var(--c-urgency-gold))'
export const OLIVE_HUE = 'rgb(var(--c-urgency-olive))'
/**
 * Cool-blue for the stale lane — a deliberately COOL hue with no overlap with the warm urgency
 * ladder (terracotta / gold / olive), so "gone cold" and "due soon" read as two different things
 * across the board. A confident azure (distinct from the muted `puppy` brand blue, which is
 * reserved for BabyClaw / habits). Reused across the ring, halo, and chip.
 */
export const STALE_HUE = 'rgb(var(--c-stale))'
/**
 * Slate for the PAUSED (dormant / future start_date) lane — a deliberately NEUTRAL, cool-grey hue
 * chosen to overlap NONE of the other card lanes: not the warm urgency ladder (terracotta / gold /
 * olive), not the cool STALE azure, and not the muted `puppy` brand blue reserved for BabyClaw /
 * habits. A paused task is a third thing entirely: it isn't due (its deadline is intentionally
 * deferred) and it isn't ignored (the user scheduled the wake) — it's just SET ASIDE, waiting for
 * its start date. Reused across the ring, tint, and chip.
 */
export const PAUSED_HUE = 'rgb(var(--c-paused))'
export type LaneHue =
  | typeof URGENT_HUE
  | typeof GOLD_HUE
  | typeof OLIVE_HUE
  | typeof STALE_HUE
  | typeof PAUSED_HUE

/** A lane hue at alpha `a`: `rgb(var(--c-accent))` → `rgb(var(--c-accent) / 0.6)`. */
export function withAlpha(hue: LaneHue, a: number): string {
  return `${hue.slice(0, -1)} / ${a})`
}

/**
 * One ring + halo box-shadow pair in a lane hue — the shape every glow, stale and paused ring
 * (and GridLegend's dot-scaled swatches) is built from: a solid `ringPx` spread ring, then a
 * `blur`/`spread` halo.
 */
export function ringShadow(
  hue: LaneHue,
  ringPx: number,
  ringAlpha: number,
  blur: number,
  spread: number,
  haloAlpha: number,
): string {
  return `0 0 0 ${ringPx}px ${withAlpha(hue, ringAlpha)}, 0 0 ${blur}px ${spread}px ${withAlpha(hue, haloAlpha)}`
}

/** Due-chip fills: the urgent terracotta, and the muted fill of the far-off tiers. */
export const DUE_BADGE_URGENT = URGENT_HUE
export const DUE_BADGE_MUTED = 'rgb(var(--c-urgency-muted))'
/** Text on every solid chip fill (due, stale, paused): white in light, dark ink in dark. */
const CHIP_TEXT = 'rgb(var(--c-on-accent))'

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
   * cluster-popup row so a clustered urgent task matches a standalone card. The
   * `backgroundColor` longhand, so it composes with (and never resets) other background layers.
   */
  backgroundColor?: string
}

/** The card's resting drop-shadow — the base depth layer that sits under every glow. Exported
 *  so GridCard can lay the cool aging ring over this same base when a card has no warm urgency
 *  glow (an inline box-shadow would otherwise clobber the card's resting `shadow-sm` class). */
export const BASE_CARD_SHADOW = '0 2px 7px rgb(var(--c-card-shadow) / 0.08)'

/**
 * Box-shadow "glow" by tier. The 2026-07-08 workshop's ~2× ladder still read too faint next to a
 * card's own 1px border, so it was pushed HARDER on 2026-07-09 ("much stronger" was the explicit
 * ask): thicker, more opaque rings that clearly out-weight the border, plus a bigger, brighter
 * halo. The tier-to-tier gradient is preserved so nearer-due still reads louder. Tints are the
 * `--c-tint-*` tokens (light = the pastel noted; dark = low-alpha hue over `card`).
 *
 * | tier          | ring + glow                          | card tint (light) |
 * |---------------|--------------------------------------|-------------------|
 * | `overdue`     | 4px solid ring + 32px glow + **pulse** | `#fff1e8`       |
 * | `final-hours` | today's ring + **soft pulse**        | `#fff4ec`         |
 * | `today`       | 3px terracotta ring + 26px glow      | `#fff7f0`         |
 * | `closing-in`  | 3px gold ring + 22px glow            | `#fdf7ec`         |
 * | `this-week`   | 2.5px olive ring + 18px glow         | `#faf7ee`         |
 * | `radar`       | faint 1.5px olive ring + 14px haze   | —                 |
 * | `none`        | none (`null`)                        | —                 |
 */
export function urgencyGlowStyle(tier: UrgencyTier): GlowStyle | null {
  switch (tier) {
    case 'overdue':
      return {
        boxShadow: `${BASE_CARD_SHADOW}, ${ringShadow(URGENT_HUE, 4, 1, 32, 12, 0.6)}`,
        animation: 'urgency-pulse 2s ease-in-out infinite',
        backgroundColor: 'rgb(var(--c-tint-overdue))',
      }
    case 'final-hours':
      return {
        boxShadow: `${BASE_CARD_SHADOW}, ${ringShadow(URGENT_HUE, 3, 0.92, 26, 10, 0.5)}`,
        animation: 'urgency-pulse-soft 3s ease-in-out infinite',
        backgroundColor: 'rgb(var(--c-tint-final-hours))',
      }
    case 'today':
      return {
        boxShadow: `${BASE_CARD_SHADOW}, ${ringShadow(URGENT_HUE, 3, 0.92, 26, 10, 0.5)}`,
        backgroundColor: 'rgb(var(--c-tint-today))',
      }
    case 'closing-in':
      return {
        boxShadow: `${BASE_CARD_SHADOW}, ${ringShadow(GOLD_HUE, 3, 0.8, 22, 8, 0.42)}`,
        backgroundColor: 'rgb(var(--c-tint-closing-in))',
      }
    case 'this-week':
      return {
        boxShadow: `${BASE_CARD_SHADOW}, ${ringShadow(OLIVE_HUE, 2.5, 0.6, 18, 6, 0.3)}`,
        backgroundColor: 'rgb(var(--c-tint-this-week))',
      }
    case 'radar':
      return {
        boxShadow: `${BASE_CARD_SHADOW}, ${ringShadow(OLIVE_HUE, 1.5, 0.35, 14, 4, 0.22)}`,
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
      return { backgroundColor: DUE_BADGE_URGENT, color: CHIP_TEXT }
    case 'closing-in':
      return { backgroundColor: GOLD_HUE, color: CHIP_TEXT }
    case 'this-week':
      return {
        backgroundColor: 'transparent',
        color: OLIVE_HUE,
        border: `1.5px solid ${withAlpha(OLIVE_HUE, 0.55)}`,
      }
    case 'radar':
    case 'none':
      return { backgroundColor: DUE_BADGE_MUTED, color: CHIP_TEXT }
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
 * cold-side mirror of the warm urgency tint (`GlowStyle.backgroundColor`). Composed by the caller
 * exactly like a glow: ring appended after the base shadow, tint replacing the paper fill. A
 * stale card never wears the warm dress at the same time (staleness gates the tier to 'none').
 */
export interface StaleRingStyle {
  boxShadow: string
  /** Cool-blue paper tint replacing the plain card fill, graduating icier with staleness depth. */
  backgroundColor?: string
}

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
 * The most recent 'YYYY-MM-DD' in a session log, or null when there is none. `worked_days` is stored
 * newest-first, but a max beats trusting the order for a value that gates a whole visual lane (and
 * 'YYYY-MM-DD' compares correctly as a plain string). Kept local: `src/lib/worked.ts` owns the rich
 * derivation, and importing it here would drag a timezone argument into a purely elapsed-time file.
 */
function latestDay(days: string[] | null | undefined): string | null {
  let latest: string | null = null
  for (const d of days ?? []) {
    const day = typeof d === 'string' ? d.slice(0, 10) : ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && (latest === null || day > latest)) latest = day
  }
  return latest
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
 *   - recently WOKEN (start_date) or recently WORKED (a logged session) → not stale, either lane
 *
 * A staged task never goes stale (it hasn't been "left on the board" yet); the recurring gate (a
 * chore carries its own status clock) stays with the caller, as it does for the warm lane.
 */
export function staleness(
  task: {
    created_at: string | null
    staged: boolean
    start_date?: string | null
    worked_days?: string[] | null
  },
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
  // Nor is a project you actually WORKED being ignored. An ongoing project chipped at every week
  // used to ice over at 90 days anyway, because the undated clock only ever read `created_at` — the
  // app knew about the sessions and said "Stale · 3mo" regardless. A logged session is the loudest
  // possible evidence of attention, so it restarts the ignored-clock exactly like a wake does.
  // Same UTC-noon projection: worked_days are wall-clock days like start_date. Deliberately NOT
  // gated on `ongoing` — only ongoing projects ever accumulate a log, and if one is later switched
  // back to a one-off the fact that real work happened last week still stands.
  const lastWorked = latestDay(task.worked_days)
  const sinceWorked = lastWorked ? daysSince(`${lastWorked}T12:00:00Z`, now) : null
  if (daysUntilDue !== null) {
    const past = -daysUntilDue
    if (past < STALE_OVERDUE_FLOOR_DAYS) return null
    // Recently (re)started or recently worked: the user scheduled this comeback / put time in, so
    // give it a full floor's worth of board time before the overdue count reads as neglect again.
    if (sinceStart !== null && sinceStart < STALE_OVERDUE_FLOOR_DAYS) return null
    if (sinceWorked !== null && sinceWorked < STALE_OVERDUE_FLOOR_DAYS) return null
    return { days: past, overdue: true, floor: STALE_OVERDUE_FLOOR_DAYS }
  }
  const created = daysSince(task.created_at, now)
  if (created === null) return null
  // Undated: board time counts from the LATEST of created_at / start_date / last session — i.e. the
  // smallest of the three ages, since "how long has this been sitting untouched" is what stale means.
  const days = Math.min(
    ...[created, sinceStart, sinceWorked].filter((n): n is number => n !== null),
  )
  if (days < STALE_UNDATED_FLOOR_DAYS) return null
  return { days, overdue: false, floor: STALE_UNDATED_FLOOR_DAYS }
}

/**
 * The cool ring + icy tint for a staleness, deepening with DEPTH (`days / floor`) so both kinds
 * ramp on the same ladder: a dated task at 3/6/9 weeks past due hits the same rungs an undated
 * one hits at 3/6/9 months on the board. Ring/halo/tint values carry over unchanged from the
 * retired created-age ladder (pushed louder than a same-rung warm tier, owner ask 2026-07-12);
 * the loudest rung still sits just under the overdue ring. Tints are `--c-tint-stale*` tokens.
 *
 * | depth        | ring + halo                   | tint (light) |
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
      boxShadow: ringShadow(STALE_HUE, 2, 0.6, 14, 3, 0.3),
      backgroundColor: 'rgb(var(--c-tint-stale))',
    }
  if (depth < 3)
    return {
      boxShadow: ringShadow(STALE_HUE, 2.5, 0.78, 20, 5, 0.42),
      backgroundColor: 'rgb(var(--c-tint-stale-deep))',
    }
  return {
    boxShadow: ringShadow(STALE_HUE, 3, 0.95, 28, 7, 0.55),
    backgroundColor: 'rgb(var(--c-tint-stale-deepest))',
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
    worked_days?: string[] | null
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
 * (`dueChipStyle('overdue')`): a solid azure fill in the same `STALE_HUE` as the ring, so
 * the textual "how stale" badge reads as a sibling of the warm "how soon" badge without ever
 * being mistaken for it.
 */
export function staleChipStyle(): DueChipStyle {
  return { backgroundColor: STALE_HUE, color: CHIP_TEXT }
}

/**
 * Whole-card opacity a paused card is dimmed to. The set-aside cue that reads even where the slate
 * ring/chip can't be told apart from another lane: a paused card is visibly quieter than every
 * active/hot/stale card, which all render at full opacity. Kept legible (not a fade-out) so the
 * card is still readable and its ⋯ menu still usable (that's the Resume path). 0.7 (up from the
 * first cut's 0.62) so the full-alpha slate ring below still punches through the dim.
 */
export const PAUSED_OPACITY = 0.7

/**
 * Ring + optional card tint for the paused lane — the same compose-into-`style` shape the warm
 * glow (`GlowStyle`) and the cool stale ring (`StaleRingStyle`) use: a box-shadow ring appended
 * after the base depth shadow, plus a tint replacing the plain paper fill.
 */
export interface PausedRingStyle {
  boxShadow: string
  backgroundColor?: string
}

/**
 * The slate ring + slate tint a dormant card wears — the set-aside lane's mirror of
 * `staleRingStyle`. BINARY (no depth ladder like staleness): a task is paused or it isn't, so
 * there's a single treatment. Pushed LOUDER on 2026-07-22 ("more noticeable" was the explicit
 * ask): a full-alpha 3px ring + a real halo + a deeper tint, sized against the stale ladder's
 * middle rung — because the whole card then dims to PAUSED_OPACITY, the effective on-screen
 * weight still sits below the hot/stale rings, which render at full card opacity. Composed by
 * the caller exactly like a glow/stale ring.
 */
export function pausedRingStyle(): PausedRingStyle {
  return {
    boxShadow: ringShadow(PAUSED_HUE, 3, 1, 24, 8, 0.45),
    backgroundColor: 'rgb(var(--c-tint-paused))',
  }
}

/**
 * Inline style for the solid slate ⏸ paused chip — the set-aside-lane mirror of the terracotta
 * due chip (`dueChipStyle('overdue')`) and the azure stale chip (`staleChipStyle`): the same
 * `PAUSED_HUE` as the ring, so the "when it comes back" badge reads as a sibling of the
 * "how soon" / "how stale" badges without ever being mistaken for either.
 */
export function pausedChipStyle(): DueChipStyle {
  return { backgroundColor: PAUSED_HUE, color: CHIP_TEXT }
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

/**
 * The 💤 paused corner badge — the set-aside lane's member of the corner-flag family: 🔥 while
 * hot, ❄️ once stale, 💤 while DORMANT (the card is literally asleep until its start date). A
 * color-independent cue like its siblings, worn in the same top-right disc on the grid card and
 * cluster row. `title` spells out when it wakes ("Paused — starts Jul 30") for hover/aria.
 */
export interface PausedBadge {
  glyph: string
  title: string
}

export function pausedBadge(startDate: string | null | undefined): PausedBadge {
  const day = startDate ? formatStartDay(startDate) : ''
  return { glyph: '💤', title: day ? `Paused — starts ${day}` : 'Paused' }
}
