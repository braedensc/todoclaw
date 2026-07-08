# grid

The free-canvas priority grid (urgency × importance). This is the app's main **desktop** screen — a
2D matrix where `x` = urgency (0 left → 1 right) and `y` = importance (0 bottom → 1 top). **Screen-y
is inverted from data-y**: a card at data `(x, y)` renders at `left: x*100%`, `top: (1−y)*100%`, so
high importance sits at the top. New tasks are added from the widget above the grid and surface as
draggable **new-item cards** there (card-in-place, B2 — there is no staging tray).

> **Mobile (< 720px) never mounts this feature** (ADR-0028): `WorkArea` renders `MobileMatrix`
> (quadrant overview → focus lists) instead, and repositioning is the tap-based Move-to-quadrant
> sheet. The tap-to-place branches referenced below are desktop-era code that only ran when the
> grid was still rendered on phones; they are unreachable today.

## Files

- **`GridView.tsx`** — orchestrator. Reads tasks (`useTasks`), the user's timezone
  (`useUserSchedule`) and today's completion map (`useDailyState`), computes which tasks are
  _placed_ vs _staged_, runs `computeClusters` over the placed tasks, and wires drag +
  tap-to-place + the cluster popup. Writes go through `useUpdateTask` / `useSoftDeleteTask`
  (tasks) and `useMarkTaskDone` (the Done data layer) — see _Mark done_ below.
- **`GridCanvas.tsx`** — the backdrop surface only: quadrant background tints, 10×10
  graph-paper lines, the two center axes, and the four corner quadrant labels (each in its
  `quadrantMeta` color). Owns the `surfaceRef` used as the drag/tap coordinate space.
- **`GridCard.tsx`** — one placed card (112px). The 3px top border encodes status: recurring
  → `RC_COLOR[recurringStatus().code]`, otherwise the quadrant color for its `(x, y)`. Renders
  the recurring status badge + `×N` badge (`doneCount ≥ 3`), the **visual-urgency layer** (glow /
  staleness / due badge — see below), the **recurring indicator** (a ↻ corner chip + dashed accent
  side borders — see below), and the hover action row (done / ⋯ menu / delete).
- **`use-grid.ts` / `GridSurface.tsx`** — the drag/placement orchestration (shared state) and the
  canvas render. `useGrid` also exposes `pendingTasks` (still-`staged` tasks) + `startNewCardDrag`
  so the add widget's **new-item cards** (`../shell/NewItemStrip.tsx`) drag onto this same canvas.
- **`grid-constants.ts`** — verbatim EisenClaw visual constants (tints, gridline/axis colors,
  card width, badge threshold).

## Which tasks show on the grid

A task renders on the canvas when **all** hold: active (soft-deleted rows are already excluded
by `useTasks`), `!staged`, not in today's `done` map, has non-null `x`/`y`, and — for recurring
tasks — its status is **not `ok`** (an `ok` recurring task is hidden to keep the grid uncluttered
between cycles). Everything with `staged === true` is a not-yet-placed task and surfaces as a
draggable new-item card in the add widget instead.

## Placement & movement

- **Reposition a placed card:** drag it (raw pointer events via `useFreeDrag`). A live "ghost"
  position tracks the pointer; on drop we commit `x`/`y` via `useUpdateTask`. **No collision
  resolution on drag** — overlaps are expected and absorbed by clustering.
- **New-item card → grid (desktop):** drag a new-item card onto the canvas → it materializes
  under the pointer and commits `{ x, y, staged: false }` on drop.
- **New-item card → grid (tap-to-place):** `use-grid.ts` still carries a tap-to-select →
  tap-to-place path gated on `useIsMobile`, from when the grid rendered below 720px. Since
  ADR-0028 the grid never mounts on mobile, so this branch is currently dead code.

## Clustering

Placed tasks are grouped by `computeClusters` (seed-based, non-transitive — math in
`src/lib/clustering.ts`). A group of **1** renders as a normal `GridCard`; a group of **>1**
collapses into a `ClusterBubble` (from `../clustering`) at the dominant task's coords, with an
expandable `ClusterPopup`. Clicking the grid background closes any open popup; dragging a popup
row out drops it at a fresh `{ x, y }` (separating it from the cluster). See
`src/features/clustering/README.md` for the bubble/popup details.

## Visual urgency (glow · pulse · staleness · due badge)

Layered on top of the quadrant border, **for non-recurring cards only** (a recurring task shows its
`RC_COLOR` status badge instead; done cards have left the grid). The tiers/constants are ported
verbatim from EisenClaw and pinned in `src/lib/visual-urgency.test.ts`; the pure logic is
`src/lib/visual-urgency.ts`. See `docs/STYLE.md` → _Visual urgency_ and `docs/ARCHITECTURE.md`
ADR-0019.

- **Glow** — `urgencyGlowStyle(daysUntilDue)` returns a `box-shadow` ring that intensifies toward
  the deadline (overdue → strongest + pulse; then today / `≤2d` / `≤7d` / `≤14d`; beyond → none).
  `GridView` computes `daysUntilDue = daysUntil(task.due, { timeZone })` and passes it as a prop, so
  the timezone lives in one place. A **cluster bubble** glows for the nearest due date in its group.
- **Pulse** — overdue items animate the global `urgency-pulse` keyframe (`src/index.css`), disabled
  under `prefers-reduced-motion`.
- **Staleness** — `stalenessStyle(task)` desaturates + fades a card by age (`created_at → now`);
  not-yet-placed (`staged`) tasks are exempt (they aren't on the grid yet).
- **Due badge** — a small `overdue`/`today`/`Nd` pill (terracotta when due `≤ 2d`, else grey;
  `DUE_BADGE_*` in `src/lib/visual-urgency.ts`, shared with the cluster popup's due chip).

## Recurring indicator (placed cards)

A recurring card is doubly marked so it reads as "repeats" at a glance, independent of the status
badge: (a) a persistent **↻ chip** overhanging the top-right corner, and (b) **dashed** accent
side/bottom borders (one-off cards keep thin solid terracotta sides). The solid, status-colored top
border is untouched, so the two cues never clash with it (batch-2 items 5 + 13).

## Card actions (placed cards) & mark done

`GridCard` reveals a three-control action row — **done ✓** (green), a **⋯ menu**, and **delete ×**
(red). Done and delete are the shared `IconButton` (green `success` / red `danger` intents, native
`title` tooltips); delete is **confirm-gated** (`useConfirm`, wired in `GridSurface`) so an
accidental click can't silently soft-delete. The row is **always visible** (an outlined Done pill
+ quiet ⋯/× — batch-2) rather than hover-only, so it also degrades safely on any touch device,
though the grid itself is desktop-only now (ADR-0028). Each control stops pointer/click
propagation so it never starts a drag.

**Inline rename** is triggered by **double-clicking the text** (there is no ✎ button — the whole
card is the drag handle, and a motionless double-click can't be confused with a drag). Enter/blur
commits `text`; Escape cancels.

**⋯ menu (due + recurring)** — a small popover (`useClickOutside` to dismiss; flips above / aligns
to the nearer edge so it stays on-canvas) holding the due-date picker + the shared
`RecurringSection` (set / edit / remove a repeat schedule). Both commit through the one generic
`updateMutate({ id, patch })`. Setting a due date writes **`due` only** — unlike BabyClaw's
`set_due_date`, it never repositions a manually-placed card.

**Mark done** (the `✓` on cards _and_ popup rows) goes through one shared handler that branches
on `task.recurring`:

- **Normal task:** `useMarkTaskDone` writes today's `daily_state` + a permanent `history` row in
  one transaction; the task then drops out of the placement filter and leaves the grid.
- **Recurring task:** `useUpdateTask` resets the cycle (`lastDoneAt = now`, `doneCount + 1`) and
  writes **no** history/`daily_state`. The task re-evaluates to `ok` and is hidden until the next
  cycle, its `×N` badge incremented.

New tasks are created from the Manual add widget above the grid (seeded `staged: true, x: 0.5,
y: 0.5`); they surface there as a draggable new-item card and this feature displays + places them.
