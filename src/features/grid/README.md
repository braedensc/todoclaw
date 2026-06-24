# grid

The free-canvas priority grid (urgency × importance) and its staging tray. This is the app's
main screen — a 2D matrix where `x` = urgency (0 left → 1 right) and `y` = importance
(0 bottom → 1 top). **Screen-y is inverted from data-y**: a card at data `(x, y)` renders at
`left: x*100%`, `top: (1−y)*100%`, so high importance sits at the top.

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
  the recurring status badge + `×N` badge (`doneCount ≥ 3`), and hover actions.
- **`StagingTray.tsx`** — lists `staged` tasks; the source of desktop drag-to-grid and mobile
  tap-select.
- **`grid-constants.ts`** — verbatim EisenClaw visual constants (tints, gridline/axis colors,
  card width, badge threshold).

## Which tasks show on the grid

A task renders on the canvas when **all** hold: active (soft-deleted rows are already excluded
by `useTasks`), `!staged`, not in today's `done` map, has non-null `x`/`y`, and — for recurring
tasks — its status is **not `ok`** (an `ok` recurring task is hidden to keep the grid uncluttered
between cycles). Everything with `staged === true` shows in the tray instead.

## Placement & movement

- **Reposition a placed card:** drag it (raw pointer events via `useFreeDrag`). A live "ghost"
  position tracks the pointer; on drop we commit `x`/`y` via `useUpdateTask`. **No collision
  resolution on drag** — overlaps are expected and absorbed by clustering.
- **Tray → grid (desktop):** drag a tray card onto the canvas → commits `{ x, y, staged: false }`.
- **Tray → grid (mobile, < 720px):** tap a tray card to select it, then tap a spot on the grid.
  Coordinates come from `toNormalized(gridRef.getBoundingClientRect(), …)` (clamped, y-inverted).
  The breakpoint is detected by `useIsMobile`.

## Clustering

Placed tasks are grouped by `computeClusters` (seed-based, non-transitive — math in
`src/lib/clustering.ts`). A group of **1** renders as a normal `GridCard`; a group of **>1**
collapses into a `ClusterBubble` (from `../clustering`) at the dominant task's coords, with an
expandable `ClusterPopup`. Clicking the grid background closes any open popup; dragging a popup
row out drops it at a fresh `{ x, y }` (separating it from the cluster). See
`src/features/clustering/README.md` for the bubble/popup details.

## Hover actions (placed cards) & mark done

`GridCard` hover reveals **done ✓**, edit (inline rename — Enter/blur commits `text`),
back-to-tray (`staged: true`), and delete (soft-delete). Each button stops pointer/click
propagation so it never starts a drag.

**Mark done** (the `✓` on cards _and_ popup rows) goes through one shared handler that branches
on `task.recurring`:

- **Normal task:** `useMarkTaskDone` writes today's `daily_state` + a permanent `history` row in
  one transaction; the task then drops out of the placement filter and leaves the grid.
- **Recurring task:** `useUpdateTask` resets the cycle (`lastDoneAt = now`, `doneCount + 1`) and
  writes **no** history/`daily_state`. The task re-evaluates to `ok` and is hidden until the next
  cycle, its `×N` badge incremented.

New tasks are created from the header "Add a task" input (seeded `staged: true, x: 0.5, y: 0.5`);
this feature only displays and places them.
