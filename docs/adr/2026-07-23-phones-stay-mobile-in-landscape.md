# ADR 2026-07-23 — Phones stay in the mobile layout in both orientations (the landscape leg of the gate)

**Date:** 2026-07-23 · **Post-launch** (touch-grid workshop, decision 1) · **Status:** Accepted · amends [ADR-0028](0028-mobile-list-only-no-grid-single-add-sheet.md)'s gate definition; extends [ADR-0020](0020-responsive-layout-one-720px-breakpoint-bottom.md) and [ADR 2026-07-22](2026-07-22-capability-keyed-insets-width-keyed-shell.md)

Rotating a phone used to cross the 719px width gate and mount the whole **desktop** shell — a
874pt-wide iPhone 16 Pro got the masthead, header pills, and inline grid crammed into ~400pt of
height. The touch-grid workshop (owner decision, 2026-07-22) settled it: **a phone is a phone in
any orientation.**

## Decision — the layout gate gains a landscape leg

Mobile now means *narrow, or coarse-pointer and landscape-phone-SHAPED*:

```
(max-width: 719px), ((pointer: coarse) and (min-aspect-ratio: 8/5) and (max-width: 1023px))
```

The leg's shape was forged by two caught bugs, one per verification layer:

- **Never key on viewport height** (adversarial review). The obvious leg — `max-height: ~500px`
  — reads the LIVE layout viewport, and the iOS software keyboard *shrinks the layout viewport*
  in installed PWAs (932→519 measured, #328). Any height ceiling makes typing on a landscape
  iPad flip the entire shell mid-keystroke: keyboard opens → viewport shorter than the ceiling →
  gate flips MOBILE → the desktop input unmounts and its draft dies → keyboard dismisses →
  viewport grows → gate flips back. Aspect is keyboard-stable on the mobile side (a keyboard
  only ever RAISES aspect) and the width bound excludes iPads regardless of their height.
- **Never assume screen == viewport** (sim lab). The first cut's 719 height ceiling wrongly
  caught landscape iPad *tabs*: browser chrome shrinks the 834pt screen to a 702pt viewport.

Bounds derivation: every landscape phone viewport has aspect ≥ 1.78 (iPhone SE standalone, the
squarest) and width ≤ 956pt (16 Pro Max); every landscape iPad is ≥ 1133pt wide (mini). `8/5`
(1.6) splits the aspect gap to phone-shaped vs iPad-shaped [1.53, 1.78]; `1023` splits the width
gap — and a deliberately phone-shaped iPad Stage-Manager window landing mobile is correct
behavior, not a leak. A portrait iPad's keyboard cannot fake the leg (744×713 ≈ 1.04 aspect).
The width constant lives as `LANDSCAPE_PHONE_MAX_WIDTH` with this derivation in its doc comment.

A landscape phone trips the second leg; iPads never do, so they keep the desktop shell in both
orientations exactly as before — ADR-0028's *what renders on each side* is untouched; only the
boundary definition changed. Fine-pointer desktop windows of any shape are also untouched (a
short 1300×450 window stays desktop — the leg requires a coarse pointer).

The gate lives in THREE lockstep places, per ADR-0020's flip-at-the-identical-boundary rule:

- `MOBILE_MEDIA_QUERY` in `src/hooks/use-is-mobile.ts` (drives `useIsMobile`, all JS gating);
- the locked-shell block in `src/index.css` (same query verbatim);
- tailwind.config.js's `wide` screen — now a `raw` query holding the exact **complement**,
  spelled `(min-width:720px) and (pointer:fine|none), (min-width:1024px), (min-width:720px) and
  (max-aspect-ratio:1599/1000)` rather than Media Queries 4 `not (...)`: an engine that can't
  parse boolean negation would silently drop every desktop style, while the query list degrades
  to nothing worse than an unknown feature. (`¬(coarse ∧ ar≥8/5 ∧ w≤1023) ≡ fine ∨ none ∨
  ar<8/5 ∨ w≥1024`; the ar leg uses 1599/1000 so the boundary is a hairline GAP at aspect
  (1.599, 1.6) rather than an overlap where both shells' styles apply at once.) All three homes
  are lockstep-pinned by `use-is-mobile.test.ts`, which reads the other two from disk.

**Rotate affordance:** since landscape is the grid's natural aspect, `RotateGridHint` floats a
"▦ View grid" pill for a few seconds after a rotation to landscape on the mobile home surface —
tap → grid-only mode (the fullscreen touch grid, PR #332/#333). It triggers ONLY on a
`screen.orientation` change EVENT (the physical-device signal): an `(orientation: landscape)`
media query flips when the standalone keyboard makes a short phone's viewport wider than tall
(the pill would pop over the composer mid-typing), and event-only means remounts — exiting the
grid, returning Home — never re-offer the door just exited. Coarse-pointer only; engines without
`screen.orientation` simply never show it (More → Grid view is always there).

## Rejected

- **Width-only gating** (the status quo): the rotate moment stayed jarring and landscape phones
  got desktop ergonomics no thumb can use.
- **`not (...)` for the wide complement** — parse-failure risk turns into a blank desktop.
- **Auto-entering grid view on rotation:** rotation is often accidental; an offered door beats a
  forced walk through it.

## Consequences

- The mobile shell (locked viewport, `--app-h`, bottom nav, MobileMatrix) now runs in landscape;
  the shell machinery already handles rotation (`useAppHeight` re-baselines on width change, the
  viewport guard's mount snap-back).
- Verified on the lab (iOS 26.5) via the probe's new pinned gate badge. First cut (height leg):
  landscape iPhone 16 MOBILE, landscape iPad Pro 11″ wrongly MOBILE — the failure that forced the
  aspect leg. Final cut: portrait iPhone MOBILE / portrait iPad DESKTOP with the complement
  agreeing on real WebKit (the badge flags non-complementarity); the landscape verdicts follow
  from the same sim-measured geometry (852×283 phone → aspect 3.0, width ≤ 1023; iPad ≥ 1133 wide
  → excluded), re-confirmable on-device next lab session. Desktop browser bit-identical with the
  `wide` raw query compiled (checked in Chromium at 1280px).
- Any future width check that means "which layout?" must use `useIsMobile` / `wide:` — never a
  raw 720px comparison.
