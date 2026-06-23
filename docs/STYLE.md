# STYLE.md

Code style, naming conventions, component patterns, state patterns, and UI/UX design choices (color palette, typography, spacing) carried over from EisenClaw.

> Filled in during Stage 2 (ESLint/Prettier config finalized) and Stage 3 (design tokens implemented). The EisenClaw palette and font choices are documented in `planning/EISENCLAW-LOGIC-TO-PORT.md` § 13.

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
