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
| `quadrant-do-now` | `#bf5e2a` | "Do Now" quadrant (urgent + important) |
| `quadrant-schedule` | `#3d7a5f` | "Schedule" quadrant (important, not urgent) |
| `quadrant-errands` | `#7d6b1e` | "Errands" quadrant (urgent, not important) |
| `quadrant-someday` | `#857c6e` | "Someday" quadrant (neither) |

> Quadrant **background tints** (the low-alpha `rgba(...)` fills behind the grid) are deferred
> to the grid PR that paints the canvas — see `EISENCLAW-LOGIC-TO-PORT.md` § 13.

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
