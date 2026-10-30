# STYLE.md

TodoClaw's code style, naming conventions, component patterns, state patterns, and UI/UX design system (color palette, typography, spacing). The design tokens below and the code that uses them are authoritative.

> Design tokens were implemented in Stage 3; the live tokens in `tailwind.config.js` are the source of truth.

---

## Design tokens

The "warm paper" palette and fonts are TodoClaw's design tokens, defined in
`tailwind.config.js` (`theme.extend`). Use the token names below — never raw hex in
components. The body base (background + text + body font) is applied in `src/index.css`
(`@layer base { body { ... } }`).

Every color token is a CSS variable: `tailwind.config.js` maps it to
`rgb(var(--c-<name>) / <alpha-value>)` (so opacity modifiers like `bg-panel/80` work), and
`src/index.css` holds the values as space-separated RGB triplets — the light set on `:root`, the
warm-charcoal dark set on `html.dark` (`darkMode: 'class'`). `src/lib/theme-tokens.test.ts` pins
that both sets define every token and that dark is at least as contrasted as light for the
checked text/fill pairs. `scripts/check-raw-colors.test.mjs` fails on a new raw color (hex,
`rgb()`/`rgba()`, `text-white`, `bg-red-*`, `[#…]`) in `src/` outside its shrinking allowlist.

### Fonts

Self-hosted via [`@fontsource`](https://fontsource.org/) — imported in `src/main.tsx`, so the
page makes **no external Google Fonts request** (privacy: nothing about a page load leaks to a
third party). Families are declared as Tailwind tokens.

| Token | Family | Use |
|---|---|---|
| `font-serif` | Fraunces (variable) | Headings / headline (e.g. the "TodoClaw" wordmark) |
| `font-sans` | IBM Plex Sans | Body / UI (the `body` default) |

### Colors

| Token | Light | Use |
|---|---|---|
| `bg` | `#f4efe6` | App background (warm paper) |
| `panel` | `#fbf8f1` | Raised panels / cards-backing |
| `card` | `#ffffff` | Task cards |
| `ink` | `#2e2a24` | Primary text; dark buttons |
| `muted` | `#706a5d` | Secondary text |
| `muted-light` | `#807768` | Tertiary text |
| `muted-faint` | `#bcb09a` | Faint labels / placeholders |
| `on-ink` | `#ffffff` | Text on solid `bg-ink` fills (inverted pills, Snackbar, Tooltip) — never `text-white` |
| `on-accent` | `#ffffff` | Text on solid `primary` / `accent` / `danger` / `puppy` fills |
| `on-ink-accent` | `#c2693f` | Terracotta glyphs on a solid `ink` fill (the error toast's ⚠) — plain `accent` washes out on dark's cream pill |
| `scrim` | `#2e2a24` | Modal overlays (`bg-scrim/40`) and the feature-tour spotlight dimmer — dark in **both** modes, unlike `ink` |
| `paper-fixed` | `#f4efe6` | Warm paper in **both** modes — the plate under fixed light artwork (the install mockups), so it never glares on charcoal |
| `border` | `#e4dcc9` | Default hairline borders |
| `border-strong` | `#ddd4c0` | Stronger borders (grid, inputs) |
| `primary` | `#5b8a72` | Green — Add / Set primary buttons |
| `accent` | `#c2693f` | Terracotta — one-time bucket dot, urgency badge |
| `primary-deep` / `accent-deep` | `#39604c` / `#8a4a29` | Small text on a `primary/10` / `accent/10` wash (the chat ✓/✕ receipts) |
| `danger` | `#b3392f` | Warm brick red — destructive/delete affordances |
| `puppy` | `#5f8aa3` | Soft slate-blue from BabyClaw's real-life namesake's eyes — BabyClaw-mode accents (active tab ring, input focus) **and the habits surface** (paw checks, bone marks, habit cards — habits are BabyClaw's daily routine). Never functional/urgency colors |
| `quadrant-do-now` | `#bf5e2a` | "Do Now" quadrant (urgent + important) |
| `quadrant-schedule` | `#3d7a5f` | "Schedule" quadrant (important, not urgent) |
| `quadrant-errands` | `#7d6b1e` | "Errands" quadrant (urgent, not important) |
| `quadrant-someday` | `#857c6e` | "Someday" quadrant (neither) |

Dark values live beside the light ones in `src/index.css` (`html.dark`).

---

## Visual urgency (glow · pulse · stale ring)

"Position = your decision. Warmth = the data." A placed card carries two independent, purely
visual signals layered on top of its quadrant color. Both are **non-interactive** and apply only
to **non-recurring** cards (a recurring task shows its `RC_COLOR` status badge instead) — and never
to a done card (it has already left the grid). The exact tiers/constants live in
`src/lib/visual-urgency.ts` (`urgencyGlowStyle`, `staleness`/`staleRingStyle`) and are pinned (authoritative) by
`src/lib/visual-urgency.test.ts` (tuned on TodoClaw's own merits — e.g. the amplified glow ladder).

Every color in this layer — and in `quadrantMeta`, `RC_COLOR` and `features/grid/grid-constants.ts`
— is applied as an inline style, so it is written as a theme-token string (`rgb(var(--c-…))` or
`rgb(var(--c-…) / α)`) that the `dark` class can reach (TOD-138). The board-only tokens
(`urgency-gold`/`-olive`/`-muted`, `tint-*`, `stale`, `paused`, `card-shadow`, the grid's
`quadrant-tint-*`/`gridline`/`axis`/`axis-label`) live in `src/index.css` beside the palette but
not in `tailwind.config.js`; `theme-tokens.test.ts` checks every `var(--c-…)` used in `src/` has a
light and a dark value. In dark, card tints are low-alpha hue over `card` rather than pastels,
the card shadow is a light rim, solid chips take `on-accent` text, and stale blue / paused slate
are lifted. Tests assert the token strings, never resolved rgb, and inline tints use the
`backgroundColor` longhand. Grid and cluster elevation (canvas, popovers, drag/lift, bubbles,
the merge-target preview) uses composite `--shadow-*` variables beside the palette (Tailwind
`shadow-canvas`/`-popover`/`-lift`, or `var(--shadow-…)` inline): on dark each shadow deepens and
the floating ones gain a faint light rim, and the merge target brightens instead of dimming (TOD-140).

- **Urgency glow** — a `box-shadow` ring that intensifies as the due date approaches, keyed on
  `daysUntil(due)` (timezone-aware). Overdue → strongest terracotta ring **+ pulse**; due today →
  ring; `≤ 2d` / `≤ 7d` / `≤ 14d` → progressively fainter; beyond 14 days (or no due date) → none.
  A **cluster bubble** glows for the nearest due date among its non-recurring members.
- **Pulse** — overdue cards/bubbles animate the `urgency-pulse` keyframe (`src/index.css`, 2s).
  Gated behind `@media (prefers-reduced-motion: reduce)`: the static ring stays, the motion stops.
- **Stale ring + icy tint** — a task that is clearly being **ignored** cools off (`staleness`,
  2026-07-13; it replaced the created-age "aging" treatment): a dated task goes stale **21 days
  past due** — the point where the 🔥 has stopped working — and an undated one only after **90
  days on the board** (it may be a long-term idea, not an ignored commitment). A stale card FLIPS
  lanes: the whole hot dress (pulse, warm tint, 🔥, terracotta chip) is replaced by a **cool-blue
  `box-shadow` ring** (azure `--c-stale`, distinct from the reserved `puppy` brand blue) that
  deepens at 1×/2×/3× the floor (3/6/9 weeks past due, or 3/6/9 months undated), **an icy card
  tint that graduates with depth** (`tint-stale` → `-deep` → `-deepest`), a **❄️ corner flag**
  replacing the 🔥, and an azure **"Stale · Nd" chip** replacing the due chip — the hot and cool
  dresses never co-exist on one card. This keeps a deliberate **inverse** of a fade-out
  treatment: an ignored task should draw the eye, not recede. A **cluster bubble** takes the ring +
  tint of its deepest-stale folded card (`clusterStaleness`), and stale members stop feeding the
  bubble's warm glow (`clusterNearestDue` skips them); expanded popup rows each show their own.
  Staged tray cards are exempt. "A signal, not a judgment."
- **Due badge** — the textual half of the layer: a small pill on non-recurring cards showing
  `overdue` / `today` / `Nd`, terracotta (`DUE_BADGE_URGENT`) when due within 2 days, muted grey
  (`DUE_BADGE_MUTED`) otherwise. Those two colors live in `src/lib/visual-urgency.ts` (html:590)
  and are shared with the cluster popup's due chip, so the badge and chip never drift.

---

## Responsive layout

Mobile-first around a **compound layout gate** — the mobile/desktop threshold for the *interaction*
and the shell. Since ADR 2026-07-23-phones-stay-mobile-in-landscape it is no longer a bare width:
mobile = `(max-width: 719px), ((pointer: coarse) and (min-aspect-ratio: 8/5) and (max-width:
1023px))` — narrow viewports PLUS landscape phones (iPads stay desktop in both orientations; the
leg is aspect+width, never height, because the iOS keyboard shrinks the layout viewport). It is
defined once as `MOBILE_MEDIA_QUERY` in `src/hooks/use-is-mobile.ts` and mirrored in
`src/index.css`'s locked-shell block and as the Tailwind **`wide`** screen (the complement, a raw
query list) in `tailwind.config.js`, so the CSS `wide:` utilities and the JS never disagree about
where the mobile/desktop line is — a lockstep pinned by `use-is-mobile.test.ts`, which reads all
three homes from disk.

Since ADR-0028, **mobile and desktop are different shells, not one squeezed layout** — `App`
JS-gates on `useIsMobile()` (ADR-0026):

- **Mobile (the gate's mobile side)** — the inline grid does not render. The task surface is `MobileMatrix`
  (`src/features/shell/`): a read-only 2×2 quadrant **overview** that opens per-quadrant **focus
  lists** (the shared `ListView` scoped by `quadrantFilter`). Repositioning is the tap-based
  **Move-to-quadrant** picker (`MoveToQuadrantSheet`), not drag. Chrome is a slim header + the
  fixed `MobileBottomNav` (Home / Add / Chat / Done / More, safe-area padded); adding goes through
  the bottom-nav ➕ → `MobileAddSheet`; contextual flows use the shared `BottomSheet` primitive.
  The signed-in content area adds `pb-28` to clear the fixed bar.
- **Desktop (`wide:` and up)** — the free-canvas grid with drag, hover-reveal card actions, the
  Grid⇄List toggle, and the full header. The grid's canvas/tray column arrangement keeps its own
  wider `lg` (1024px) breakpoint (`GridView`): side-by-side canvas + 256px tray needs more room
  than 720px, so tablets stay stacked even though the shell is already in desktop mode.

(The Stage-5-era mobile design — bottom `TabNav`, a mobile grid with tap-to-place, always-visible
grid-card actions — was replaced by ADR-0025/0026/0028. `use-grid.ts` still carries its own dead
tap-to-place path; the mobile grid that DOES exist today is grid-only mode's fullscreen
`TouchGridSurface` (2026-07-22 workshop), a deliberate exception to "no grid on mobile" with its
own touch interaction grammar.)
