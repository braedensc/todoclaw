// The one-line decoder under the grid for the urgency ladder (2026-07-08 workshop): tiny
// card-like swatches wearing scaled-down versions of the real tier rings, plus the ⏰
// convention. Deliberately quiet (11px, muted) — the cards should explain themselves; this is
// confirmation, not instruction. Desktop-only by construction (the grid never renders on
// mobile, ADR-0028; mobile's colored list chips carry their meaning in words).

// Dot-scaled echoes of urgencyGlowStyle's rings — full card spreads would swamp a 10px swatch.
// Ring alphas match lib/visual-urgency.ts's (stronger, 2026-07-09) ladder exactly; only the halo
// spread is scaled to ~1/3 for the dot. Keep the two in step.
const SWATCHES: Array<{ label: string; shadow: string }> = [
  {
    label: 'due this week',
    shadow: '0 0 0 1.5px rgba(138,120,40,0.6), 0 0 5px 2px rgba(138,120,40,0.28)',
  },
  {
    label: 'within 2 days',
    shadow: '0 0 0 2px rgba(184,134,42,0.8), 0 0 6px 2px rgba(184,134,42,0.4)',
  },
  {
    label: 'due today',
    shadow: '0 0 0 2px rgba(194,105,63,0.92), 0 0 7px 3px rgba(194,105,63,0.48)',
  },
  {
    label: 'overdue (pulses)',
    shadow: '0 0 0 2.5px rgba(194,105,63,1), 0 0 9px 4px rgba(194,105,63,0.55)',
  },
]

export function GridLegend() {
  return (
    <div
      data-testid="urgency-legend"
      className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-muted"
    >
      {SWATCHES.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full border border-border bg-card"
            style={{ boxShadow: s.shadow }}
          />
          {s.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span aria-hidden>⏰</span> has a set time
      </span>
    </div>
  )
}
