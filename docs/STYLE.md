# STYLE.md

Code style, naming conventions, component patterns, state patterns, and UI/UX design choices (color palette, typography, spacing) carried over from EisenClaw.

> Filled in during Stage 2 (ESLint/Prettier config finalized) and Stage 3 (design tokens implemented). The EisenClaw palette and font choices are documented in `planning/EISENCLAW-LOGIC-TO-PORT.md` § 13.

---

## Design tokens

The EisenClaw "warm paper" palette and fonts are implemented as Tailwind theme tokens in
`tailwind.config.js` (`theme.extend`). Use the token names below — never raw hex in
components. The body base (background + text + body font) is applied in `src/index.css`
(`@layer base { body { ... } }`); exact source hex values are in
`planning/EISENCLAW-LOGIC-TO-PORT.md` § 13.

### Fonts

Self-hosted via [`@fontsource`](https://fontsource.org/) — imported in `src/main.tsx`, so the
page makes **no external Google Fonts request** (privacy: nothing about a page load leaks to a
third party). Families are declared as Tailwind tokens.

| Token | Family | Use |
|---|---|---|
| `font-serif` | Fraunces (variable) | Headings / headline (e.g. the "Todoclaw" wordmark) |
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
| `puppy` | `#5f8aa3` | Soft slate-blue from BabyClaw's real-life namesake's eyes — BabyClaw-mode accents only (active tab ring, input focus), never functional/urgency colors |
| `quadrant-do-now` | `#bf5e2a` | "Do Now" quadrant (urgent + important) |
| `quadrant-schedule` | `#3d7a5f` | "Schedule" quadrant (important, not urgent) |
| `quadrant-errands` | `#7d6b1e` | "Errands" quadrant (urgent, not important) |
| `quadrant-someday` | `#857c6e` | "Someday" quadrant (neither) |

> Quadrant **background tints** (the low-alpha `rgba(...)` fills behind the grid) are deferred
> to the grid PR that paints the canvas — see `EISENCLAW-LOGIC-TO-PORT.md` § 13.

---

## Visual urgency (glow · pulse · staleness)

"Position = your decision. Warmth = the data." A placed card carries two independent, purely
visual signals layered on top of its quadrant color. Both are **non-interactive** and apply only
to **non-recurring** cards (a recurring task shows its `RC_COLOR` status badge instead) — and never
to a done card (it has already left the grid). The exact tiers/constants are ported verbatim from
EisenClaw (`EISENCLAW-LOGIC-TO-PORT.md` §4/§5) and pinned in `src/lib/visual-urgency.test.ts`; the
logic itself is `src/lib/visual-urgency.ts` (`urgencyGlowStyle`, `stalenessStyle`).

- **Urgency glow** — a `box-shadow` ring that intensifies as the due date approaches, keyed on
  `daysUntil(due)` (timezone-aware). Overdue → strongest terracotta ring **+ pulse**; due today →
  ring; `≤ 2d` / `≤ 7d` / `≤ 14d` → progressively fainter; beyond 14 days (or no due date) → none.
  A **cluster bubble** glows for the nearest due date among its non-recurring members.
- **Pulse** — overdue cards/bubbles animate the `urgency-pulse` keyframe (`src/index.css`, 2s).
  Gated behind `@media (prefers-reduced-motion: reduce)`: the static ring stays, the motion stops.
- **Staleness dust** — a card untouched for weeks desaturates + fades by age (`created_at → now`):
  `< 21d` none, `< 45d` `saturate(0.8)`/`0.90`, `< 75d` `saturate(0.55)`/`0.82`, `≥ 75d`
  `saturate(0.3)`/`0.72`. Staged tray cards never desaturate. "A signal, not a judgment."
- **Due badge** — the textual half of the layer: a small pill on non-recurring cards showing
  `overdue` / `today` / `Nd`, terracotta (`DUE_BADGE_URGENT`) when due within 2 days, muted grey
  (`DUE_BADGE_MUTED`) otherwise. Those two colors live in `src/lib/visual-urgency.ts` (html:590)
  and are shared with the cluster popup's due chip, so the badge and chip never drift.

---

## Responsive layout

Mobile-first around a **720px breakpoint** — the mobile/desktop threshold for the *interaction* and
the shell. It is defined once as `MOBILE_MAX_WIDTH` (719) in `src/hooks/use-is-mobile.ts` and
mirrored as a Tailwind screen named **`wide`** (`min-width: 720px`) in `tailwind.config.js`, so the
CSS `wide:` utilities and the JS never disagree about where the mobile/desktop line is (which a
stock `md` = 768px breakpoint would).

Since ADR-0028, **mobile and desktop are different shells, not one squeezed layout** — `App`
JS-gates on `useIsMobile()` (ADR-0026):

- **Mobile (< 720px)** — the pixel grid does not render at all. The task surface is `MobileMatrix`
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
grid-card actions — was replaced by ADR-0025/0026/0028. `use-grid.ts` still carries the
tap-to-place path, but nothing mounts the grid below 720px.)

---

## Visual parity reference (screenshots)

Ground-truth screenshots of the original EisenClaw UI live in
`planning/eisenclaw-export/pics/` (gitignored — local reference, never published).
Use them alongside the parity spec (`eisenclaw.md`) and the exact tokens in
`EISENCLAW-LOGIC-TO-PORT.md` § 13 when building each surface in Stage 3.

| File | Surface shown |
|---|---|
| `Todopic1.jpeg` | **Grid view** — header + Plan my day / Backups, add-task box, Grid/List/Done tabs, urgency×importance canvas with quadrant labels (Schedule / Do Now / Someday / Errands), task cards, cluster bubbles (2/3 TASKS), recurring "overdue" badges, urgency glow rings |
| `Todopic2.jpeg` | **Cluster popup** — "N TASKS HERE" floating panel with card-style rows (done / recurring / edit / delete), stacked-depth bubble shadows |
| `Todopic3.jpeg` | **Daily habits** — expandable habit with steps (Wrist routine), collapsed habits, add-step / add-habit inputs, grid footer legend |
| `Todopic4.jpeg` | **List view** — priority-ranked rows, #1 expanded with urgency/importance sliders + number inputs + date picker + quadrant badge + recurring section; colored left borders per quadrant |
| `Todopic5.jpeg` | **Done tab** — permanent completion history; ↩ restores tasks marked done today, × removes from history only |
| `Todopic6.jpeg` | **List view** (≈ duplicate of `Todopic4`) |

Confirmed visuals: warm paper palette (bg `#f4efe6`), Fraunces serif headings + IBM Plex
Sans body, green primary buttons (`#5b8a72`), dark header buttons, terracotta recurring/urgency
accents (`#c2693f`). Exact hex values: `EISENCLAW-LOGIC-TO-PORT.md` § 13.
