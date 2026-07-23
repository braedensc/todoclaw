# STYLE.md

TodoClaw's code style, naming conventions, component patterns, state patterns, and UI/UX design system (color palette, typography, spacing). The design tokens below and the code that uses them are authoritative.

> Design tokens were implemented in Stage 3; the live tokens in `tailwind.config.js` are the source of truth.

---

## Design tokens

The "warm paper" palette and fonts are TodoClaw's design tokens, defined in
`tailwind.config.js` (`theme.extend`). Use the token names below — never raw hex in
components. The body base (background + text + body font) is applied in `src/index.css`
(`@layer base { body { ... } }`).

### Fonts

Self-hosted via [`@fontsource`](https://fontsource.org/) — imported in `src/main.tsx`, so the
page makes **no external Google Fonts request** (privacy: nothing about a page load leaks to a
third party). Families are declared as Tailwind tokens.

| Token | Family | Use |
|---|---|---|
| `font-serif` | Fraunces (variable) | Headings / headline (e.g. the "TodoClaw" wordmark) |
| `font-sans` | IBM Plex Sans | Body / UI (the `body` default) |

### Colors

| Token | Hex | Use |
|---|---|---|
| `bg` | `#f4efe6` | App background (warm paper) |
| `panel` | `#fbf8f1` | Raised panels / cards-backing |
| `card` | `#ffffff` | Task cards |
| `ink` | `#2e2a24` | Primary text; dark buttons |
| `muted` | `#7a7466` | Secondary text |
| `muted-light` | `#9a9080` | Tertiary text |
| `muted-faint` | `#bcb09a` | Faint labels / placeholders |
| `border` | `#e4dcc9` | Default hairline borders |
| `border-strong` | `#ddd4c0` | Stronger borders (grid, inputs) |
| `primary` | `#5b8a72` | Green — Add / Set primary buttons |
| `accent` | `#c2693f` | Terracotta — one-time bucket dot, urgency badge |
| `puppy` | `#5f8aa3` | Soft slate-blue from BabyClaw's real-life namesake's eyes — BabyClaw-mode accents (active tab ring, input focus) **and the habits surface** (paw checks, bone marks, habit cards — habits are BabyClaw's daily routine). Never functional/urgency colors |
| `quadrant-do-now` | `#bf5e2a` | "Do Now" quadrant (urgent + important) |
| `quadrant-schedule` | `#3d7a5f` | "Schedule" quadrant (important, not urgent) |
| `quadrant-errands` | `#7d6b1e` | "Errands" quadrant (urgent, not important) |
| `quadrant-someday` | `#857c6e` | "Someday" quadrant (neither) |

---

## Visual urgency (glow · pulse · stale ring)

"Position = your decision. Warmth = the data." A placed card carries two independent, purely
visual signals layered on top of its quadrant color. Both are **non-interactive** and apply only
to **non-recurring** cards (a recurring task shows its `RC_COLOR` status badge instead) — and never
to a done card (it has already left the grid). The exact tiers/constants live in
`src/lib/visual-urgency.ts` (`urgencyGlowStyle`, `staleness`/`staleRingStyle`) and are pinned (authoritative) by
`src/lib/visual-urgency.test.ts` (tuned on TodoClaw's own merits — e.g. the amplified glow ladder).

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
  `box-shadow` ring** (azure `50,118,205`, distinct from the reserved `puppy` brand blue) that
  deepens at 1×/2×/3× the floor (3/6/9 weeks past due, or 3/6/9 months undated), **an icy card
  tint that graduates with depth** (`#f3f8fd` → `#eaf3fc` → `#e0edfb`), a **❄️ corner flag**
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
