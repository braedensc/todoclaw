# ADR 2026-07-22 — Safe-area insets and touch ergonomics key on capability; the locked shell stays width-keyed

**Date:** 2026-07-22 · **Post-launch** (mobile shell) · **Status:** Accepted · refines [ADR-0020](0020-responsive-layout-one-720px-breakpoint-bottom.md), leaves [ADR-0028](0028-mobile-list-only-no-grid-single-add-sheet.md) unchanged · the *layout gate itself* (which this ADR keeps the shell keyed to) later gained a landscape-phone leg — [ADR 2026-07-23](2026-07-23-phones-stay-mobile-in-landscape.md) — so "width-keyed" now reads "layout-gate-keyed": the shell still flips exactly with the layout, never with bare capability

A device-debugging report (iPad + landscape-iPhone follow-up to #329) flagged that **all** iOS
shell behavior was gated on the one `(max-width: 719px)` layout breakpoint: the locked
`--app-h` shell, `useAppHeight`/`useLockedViewportGuard`, the safe-area **top** padding, and the
16px anti-auto-zoom rule. But `index.html`'s `viewport-fit=cover` spans content under the status
bar at *every* width — so an iPad in standalone (744–834pt portrait, wider landscape) and a
landscape iPhone (874pt on the 16 Pro) fell on the desktop side and lost everything: content
under the status bar on iPad, focus auto-zoom in landscape, no touch-sized targets. #329 had
already moved the **horizontal** insets out of the width query; this ADR finishes the job with a
principle instead of another one-off.

## Decision — three mechanisms, three keys

**Width answers "which layout?" — nothing else.** Each shell mechanism is keyed on the thing it
actually depends on:

- **Safe-area insets key on `env()` itself — unconditional.** `env(safe-area-inset-*)` resolves
  `0` wherever there is no inset, so the rules are self-gating: body now carries **top** (new,
  was inside the width query) + left/right (#329) at every width. **Bottom** is the one split
  rule: below the breakpoint the bottom nav owns its own inset (a body pad would double it);
  at `≥ 720px` the page scrolls normally, so body pads the scroll end clear of the home
  indicator.
- **Touch form ergonomics key on the input capability:** `(max-width: 719px), (pointer: coarse)`.
  The coarse-pointer leg is the real key (iOS auto-zooms sub-16px fields on a landscape iPhone
  regardless of width; iPads want 44px slider targets); the width leg is kept so narrow desktop
  windows and phone-viewport test harnesses (device-lab, golden mobile project) render exactly
  like phones whether or not they emulate touch.
- **The locked viewport shell stays width-keyed — deliberately.** `--app-h` +
  `overflow: hidden` + `useAppHeight` + `useLockedViewportGuard` are not device fixes; they are
  the mobile **layout's** contract (in-flow bottom nav as the flex column's last child, inner
  scroll region, page never scrolls). The desktop-side layout scrolls the page normally —
  `useLockedViewportGuard` snaps `window.scrollY` back to 0, so re-keying it to
  `(pointer: coarse)` would fight every legitimate scroll on an iPad. Shell and layout must
  flip together, at the same 720px line (ADR-0020/0028).

## Rejected

- **Wholesale re-key of the shell to `(pointer: coarse)` / `navigator.standalone`** (the
  report's opening proposal) — breaks page scroll on every desktop-side touch device, per above.
- **`matchMedia('(display-mode: standalone)')` as a standalone signal — never use it.** Measured
  in the #329 sim sessions: iOS 26 home-screen web apps do **not** match it.
  `navigator.standalone === true` is the JS-side signal (already used by `use-app-height.ts`);
  no CSS rule in this pass needs a standalone key at all — `env()` self-gates.

## Consequences

- iPad standalone (both orientations) clears the status bar; landscape iPhone no longer
  auto-zooms on field focus; coarse-pointer devices at desktop widths get 16px fields + padded
  slider hit areas. Desktop browsers are bit-identical (`env()` = 0, fine pointer, ≥ 720px).
- The planned iPad "hybrid" view (grid + touch-friendly interaction — its own workshop) inherits
  correct insets and ergonomics regardless of what layout it picks; that workshop only owes the
  *arrangement*.
- Any future shell mechanism must name its key explicitly: layout → width; inset → `env()`;
  touch ergonomics → pointer capability; standalone JS logic → `navigator.standalone`.
