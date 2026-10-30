// The one-line decoder under the grid for the two glow ladders (2026-07-08 workshop): tiny
// card-like swatches wearing scaled-down versions of the real tier rings, plus the ⏰
// convention. Two hue lanes: the WARM ladder = due-date urgency, the COOL pair = staleness (a
// task ignored long past due — or undated for months — cools off but gains presence). Deliberately
// quiet (11px, muted) — the cards should explain themselves; this is confirmation, not
// instruction. Desktop-only by construction (the grid never renders on mobile, ADR-0028; mobile's
// colored list chips carry their meaning in words).

import {
  GOLD_HUE,
  OLIVE_HUE,
  PAUSED_HUE,
  STALE_HUE,
  URGENT_HUE,
  ringShadow,
} from '../../lib/visual-urgency'

interface Swatch {
  label: string
  shadow: string
}

// Dot-scaled echoes of urgencyGlowStyle's WARM rings — full card spreads would swamp a 10px
// swatch. Built with the same ringShadow + lane hues as lib/visual-urgency.ts (so they follow the
// theme); ring alphas match its (stronger, 2026-07-09) ladder exactly, only the halo spread is
// scaled to ~1/3 for the dot. Keep the two in step.
const SWATCHES: Swatch[] = [
  { label: 'due this week', shadow: ringShadow(OLIVE_HUE, 1.5, 0.6, 5, 2, 0.28) },
  { label: 'within 2 days', shadow: ringShadow(GOLD_HUE, 2, 0.8, 6, 2, 0.4) },
  { label: 'due today', shadow: ringShadow(URGENT_HUE, 2, 0.92, 7, 3, 0.48) },
  { label: 'overdue (pulses)', shadow: ringShadow(URGENT_HUE, 2.5, 1, 9, 4, 0.55) },
]

// Dot-scaled echoes of the COOL-BLUE staleRingStyle rings — same STALE_HUE, halo scaled to ~1/3
// for the dot. Two rungs stand in for the three depth tiers (a card colder than these just reads
// "long stale"). A task goes stale once it's clearly being IGNORED — 3+ weeks past due (the 🔥
// cools into ❄️), or months on the board for an undated card. Keep in step with
// lib/visual-urgency.ts.
const STALE_SWATCHES: Swatch[] = [
  { label: 'stale (long past due)', shadow: ringShadow(STALE_HUE, 2, 0.6, 5, 2, 0.3) },
  { label: 'long stale', shadow: ringShadow(STALE_HUE, 2.5, 0.95, 6, 2, 0.45) },
]

// Dot-scaled echo of the SLATE pausedRingStyle ring — same PAUSED_HUE, halo scaled to ~1/3 for
// the dot. One rung (the paused lane is binary): a card with a future start date sleeps, dimmed,
// at its spot until the date arrives. Keep in step with lib/visual-urgency.ts.
const PAUSED_SWATCH: Swatch = {
  label: 'paused (dimmed)',
  shadow: ringShadow(PAUSED_HUE, 2, 1, 7, 3, 0.45),
}

function SwatchItem({ label, shadow }: Swatch) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full border border-border bg-card"
        style={{ boxShadow: shadow }}
      />
      {label}
    </span>
  )
}

export function GridLegend() {
  return (
    <div
      data-testid="urgency-legend"
      className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-muted"
    >
      {SWATCHES.map((s) => (
        <SwatchItem key={s.label} {...s} />
      ))}
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span aria-hidden>⏰</span> has a set time
      </span>
      {/* Divider between the warm urgency lane and the cool stale lane. */}
      <span aria-hidden className="text-border">
        |
      </span>
      {STALE_SWATCHES.map((s) => (
        <SwatchItem key={s.label} {...s} />
      ))}
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span aria-hidden>❄️</span> how long it&apos;s been ignored
      </span>
      {/* Divider between the cool stale lane and the slate paused lane. */}
      <span aria-hidden className="text-border">
        |
      </span>
      <SwatchItem {...PAUSED_SWATCH} />
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span aria-hidden>💤</span> asleep until its start date
      </span>
    </div>
  )
}
