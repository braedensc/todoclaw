# ADR-0019 — Visual urgency: pure-lib style tiers + global keyframe (Stage 5 PR1)

**Date:** 2026-07-02 · **Stage:** 5 (PR1) · **Status:** Accepted

> **Update 2026-07-11 — the "staleness" fade was replaced by an aging RING.** The `stalenessStyle`
> desaturate-and-fade described below (which dimmed old cards into the background) proved backwards
> — an old, undone task is usually one to confront, not hide. It's now `agingRingStyle`: a cool
> slate `box-shadow` ring that _grows_ with age, so old cards gain presence instead of losing it.
> The pure-lib / pinned-tiers / scope-guard decisions in this ADR still hold; only the visual
> treatment (and the function name) changed. See `docs/STYLE.md` → _Visual urgency_.
>
> **Update 2026-07-13 — the aging ring became the STALE lane.** The cool treatment now keys off
> being *ignored*, not age: a dated task cools 21 days past due (the 🔥 corner flag flips to ❄️ and
> the due chip becomes an azure "Stale · Nd"), an undated one only after 90 days on the board.
> `agingRingStyle` is now `staleness` → `staleRingStyle`/`staleBadge`. Same pure-lib shape.

Stage 5's first polish PR ports EisenClaw's "warmth = the data" layer (glow, pulse, staleness) onto
placed cards + cluster bubbles. Decisions:

- **Ported into a pure lib, not inlined in the component.** `src/lib/visual-urgency.ts` exposes
  `urgencyGlowStyle(daysUntilDue)` and `stalenessStyle(task, now?)`, returning plain style objects
  (`{boxShadow, animation?}` / `{filter, opacity}`) or `null` for "no effect". The exact rgba/px
  tiers (LOGIC-TO-PORT §4/§5, html:77-95) live in ONE place and are pinned by
  `visual-urgency.test.ts` at every boundary — so a value change is a deliberate, reviewed diff, not
  an accidental drift. `GridCard`/`ClusterBubble` only spread the result. This mirrors how scoring /
  recurring / clustering math already live in `src/lib` and the components stay presentational.
- **Applied inline; the pulse keyframe is global.** The glow is a multi-layer `box-shadow` with a
  baked-in drop shadow, set as an inline style (inline wins over the resting Tailwind `shadow-*`
  class, including on hover, so the glow persists). Keyframes can't be inline, so `urgency-pulse`
  lives in `src/index.css` and is referenced by name from the inline `animation`.
- **`daysUntil` is computed by the caller (GridView), not the card.** The card is handed a
  `daysUntilDue: number | null` prop so the timezone (`useTimeZone`) resolves in one place; the same
  value drives the cluster bubble's glow (nearest due date among non-recurring members) and the
  card's due badge. Staleness needs only `created_at`/`staged`, so the card computes it directly.
- **Scope guards match EisenClaw exactly:** glow + staleness apply only to **non-recurring** cards
  (a recurring task carries its own `RC_COLOR` status), never to done cards (already off-grid), and
  staged tray cards never desaturate. The **non-recurring due badge** (`overdue`/`today`/`Nd`,
  html:590) was missing from the Stage 3 card and is added here as the textual half of the layer.
- **Accessibility beyond parity:** a `@media (prefers-reduced-motion: reduce)` rule stops the pulse
  (keeping the static ring) — a deliberate, non-parity enhancement for a "professional app".

**Verified.** 36 unit/DOM tests (every glow/staleness tier pinned; GridView asserts the pulse
`animation`, stale `opacity`, due-badge text, and recurring suppression land on the real node);
typecheck/lint/format green; a throwaway harness rendering the real components across all tiers was
screenshotted in-browser (glow gradient, overdue pulse, staleness fade, cluster glow) and removed.
Golden suite unaffected — no spec sets a due date, so glow/badge never render in it; selectors
unchanged.
