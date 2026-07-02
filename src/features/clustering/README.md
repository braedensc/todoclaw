# clustering

Card clustering for the priority grid. When placed cards overlap, they collapse into a single
**cluster bubble** that expands into a **popup** of card-style rows. The clustering *math* lives
in `src/lib/clustering.ts` (`computeClusters`, `clusterDominant`, `clusterAccentColor`); this
feature is the *presentation* layer. `GridView` (in `../grid`) owns the state and wiring — these
components are pure-ish and driven entirely by props.

## Algorithm (recap — see `src/lib/clustering.ts`)

Seed-based and **non-transitive**: pop a seed, group every still-pooled task within
`CX = 0.09` (x) and `CY = 0.07` (y) of it on **both** axes, and never re-seed the seed's
neighbors. So moving one "bridge" card can't cascade-regroup distant clusters. A group of 1
renders as a normal `GridCard`; a group of >1 becomes a bubble.

## Files

- **`ClusterBubble.tsx`** — a 64px circle at the **dominant task's** coords (y-inverted by the
  caller), ringed/colored by `clusterAccentColor` (recurring color if the dominant is recurring,
  else its quadrant color). Shows the count above a "TASKS" hint, with up to two faint depth
  rings (`group.slice(1, 3)`, each offset 4px) implying the stack. Clicking toggles the popup,
  which is passed in as `children` so it anchors to the bubble's positioned wrapper. Accepts an
  optional **`glow`** prop (`urgencyGlowStyle` result) that `GridView` computes from the nearest
  due date among the group's non-recurring tasks — applied only while **closed** (an open bubble
  uses its raised popup shadow). See `docs/STYLE.md` → _Visual urgency_.
- **`ClusterPopup.tsx`** — the floating panel (width 220, maxHeight 320, scrollable). It
  **flips above** the bubble when the dominant's **data-y > 0.55** (`CLUSTER_POPUP_FLIP_Y`,
  matching EisenClaw `html:616-617` — data-y high ⇒ bubble near the top of the y-inverted
  screen), else opens below. Each task is a card-style row: **done ✓**, text, a status chip
  (recurring `↻` or a due-day chip), **edit ↗**, **delete ×**. The whole row is a drag handle;
  pressing and dragging it pulls the task out of the cluster (see below).
- **`cluster-constants.ts`** — verbatim EisenClaw visual constants (bubble size, depth offset,
  popup width/height, flip threshold).

## Interactions (state owned by `GridView`)

- **Open / close:** click a bubble to open its popup; click the grid background to close it.
  Only one popup is open at a time (`openClusterId` = the dominant task id).
- **Mark done:** the row's `✓` (and the grid card's `✓`) call one shared handler that branches
  on `task.recurring` — a normal task writes history via `useMarkTaskDone`; a recurring task
  resets its cycle (`lastDoneAt = now`, `doneCount + 1`) via `useUpdateTask`, writing **no**
  history. Either way the task leaves the grid and any open popup closes.
- **Drag out:** pressing and dragging a popup row reuses `useFreeDrag` against the grid surface;
  on drop it commits the row's new `{ x, y, staged: false }` (separating it from the seed) and
  closes the popup. Desktop pointer drag only — mobile tap-to-place stays on the tray.

## Why the math is shared, not duplicated

`computeClusters` / `clusterDominant` / `clusterAccentColor` are pure and unit-tested in
`src/lib/clustering.test.ts`. These components never recompute thresholds, scores, or accent
colors — they only render what those functions return, so grid cards, the list view, and any
future consumer stay in lockstep.
