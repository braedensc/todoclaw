// Animated "thinking" affordance for in-flight AI calls — a gently pulsing ✦ sparkle followed by
// the label and a cycling ellipsis. Used by the Plan My Day pending button and the BabyClaw
// "Working…" status line so a running request reads as alive rather than a frozen static string.
//
// Motion is CSS-only (keyframes + classes live in src/index.css) so `prefers-reduced-motion:
// reduce` can neutralize it there — the sparkle and dots then render statically (✦ Label …).
// AnimatedDots is exported separately for surfaces that already own their own leading glyph (the
// BabyClaw sub-line reuses its ✦ status icon), so they don't render a second sparkle.

export function AnimatedDots() {
  return (
    <span className="thinking-dots" aria-hidden>
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  )
}

export function Thinking({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className="thinking-sparkle">
        ✦
      </span>
      {label}
      <AnimatedDots />
    </span>
  )
}

// BabyClaw-specific alternative to AnimatedDots — three paw prints fading in like footsteps
// instead of plain dots. Used only for his own inline "Working…" status line (TaskInputWidget),
// so that one spot carries a bit more of his identity; every other in-flight state (Plan My Day's
// Thinking button, etc.) keeps the neutral ellipsis. Same fade timing + reduced-motion handling.
export function PawSteps() {
  return (
    <span className="paw-steps" aria-hidden>
      <span>🐾</span>
      <span>🐾</span>
      <span>🐾</span>
    </span>
  )
}
