# ADR-0020 — Responsive layout: one 720px breakpoint, bottom tab bar on mobile (Stage 5 PR2)

**Date:** 2026-07-02 · **Stage:** 5 (PR2) · **Status:** Superseded in part by [ADR-0026](0026-mobile-chrome-slim-topbar-bottom-nav.md) / [ADR-0028](0028-mobile-list-only-no-grid-single-add-sheet.md) — the mobile shell (bottom tab bar, mobile grid, always-visible card actions) was replaced; the breakpoint governs *layout* only per [ADR 2026-07-22](2026-07-22-capability-keyed-insets-width-keyed-shell.md) (safe-area insets and touch ergonomics key on capability), and since [ADR 2026-07-23](2026-07-23-phones-stay-mobile-in-landscape.md) the layout gate is COMPOUND (720px width plus a landscape-phone leg), no longer a single width

Makes the app mobile-first at the `< 720px` breakpoint and adds a mobile golden E2E project.
Decisions:

- **One breakpoint for the interaction + shell, defined once.** The mobile/desktop threshold is
  `MOBILE_MAX_WIDTH` (719) in `use-is-mobile.ts`, driving `useIsMobile()` (which already flips the
  grid to tap-to-place, ADR-0004). Stage 5 mirrors it as a Tailwind screen `wide: '720px'` so the
  pieces keyed off it — the view nav, grid-card action visibility, and tap-to-place — **flip at the
  identical width**, with no 720–768 zone where a stock breakpoint (`md`) would disagree with
  `useIsMobile`. Adding `wide` via `theme.extend.screens` keeps Tailwind's defaults. NOTE: the
  grid's canvas/tray *column* arrangement is deliberately NOT moved to `wide`; it keeps its
  pre-existing `lg` (1024px) breakpoint because a side-by-side canvas + 256px tray needs more room
  than 720px. So on a 720–1023px tablet the nav/interaction are in desktop mode while the grid is
  still stacked — a layout choice, not an interaction mismatch (drag/tap behave identically either
  way).
- **Bottom tab bar on mobile** (master plan's explicit call), top row on desktop — one
  `<nav aria-label="Views">` with responsive classes, NOT two components. The buttons and
  `aria-current` are identical across layouts, so the semantic selectors the golden suite relies on
  (`switchTab`) are unchanged. Chosen over top-tabs-everywhere (thumb reach) and over a JS-rendered
  nav (keeps `TabNav` a pure presentational component; CSS-only avoids a render-time flip).
- **Grid card actions become touch-reachable.** The Stage 3 card revealed done/edit/delete on
  hover only — unreachable on touch. They are now always shown below `wide` (gated on the same
  breakpoint), so a placed card stays actionable on a phone. This is a genuine mobile bug the
  responsive pass surfaced, fixed here rather than deferred.
- **Chat panel goes full-screen on mobile.** Adding a *fixed* bottom bar exposed a stacking clash:
  the chat slide-over was `z-40 w-full max-w-sm` (a 384px right drawer), same z as the new bar, so
  on a phone it half-covered the bar and left tabs untappable. Fixed by making the drawer full-width
  on mobile (`w-full wide:max-w-sm`) at `z-50`, so it cleanly covers the bar (close it to return) —
  standard mobile drawer behaviour. `PlanMyDayPanel` was already a `z-50 inset-0` modal, unaffected.
- **Mobile golden specs as a second Playwright project.** `playwright.golden.config.ts` gains a
  `chromium-mobile` project (Pixel 7 viewport + touch) matching `*.mobile.golden.spec.ts`; the
  desktop `chromium` project `testIgnore`s that pattern (since `*.golden.spec.ts` also matches it).
  Both depend on the same `setup` project and shared test user — the per-test DB wipe keeps them
  independent. A `tapPlaceTask` helper mirrors the desktop `placeTask` for the tap-to-place flow.
  This follows Stage 4.5's "each feature PR grows the golden suite" (ADR-0018) and lands the mobile
  tap-to-place specs the plan deferred from Stage 4.5.

**Verified.** typecheck/lint/format green; 167 unit tests unaffected; the responsive shell (real
`TabNav` + header markup) was screenshotted at 390px (bottom bar, stacked header) and 1280px (top
tabs, single-row header) via a throwaway harness, then removed. The mobile golden specs are authored
against the running local stack; like all golden specs they are a local, sequenced run (they share
the one test user) — run before merge.
