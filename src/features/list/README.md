# list

Priority-ranked list view (Stage 3 PR5). Rows are the user's active tasks ordered by
`taskScore` descending — importance (y, 0.55) weighted above urgency (x, 0.45), plus a
due-soon bonus (`src/lib/scoring.ts`).

## Components

- **`ListView.tsx`** — orchestrator. Reads `useTasks` / `useUserSchedule` / `useDailyState` /
  `useMarkTaskDone`, excludes tasks already done today, **includes** staged tasks, sorts by
  score descending, and renders one `ListRow` per task. Owns the mutation wiring
  (`useUpdateTask`, `useSoftDeleteTask`, `useMarkTaskDone`); the row components stay
  presentational. Empty state when no active tasks remain.
- **`ListRow.tsx`** — one ranked row: quadrant-colored rank number + 4px left border, a
  recurring glyph badge (cadence + status in the tooltip, `src/lib/recurring.ts`), a `×N`
  recurring completion badge (`doneCount ≥ 3`, mirrors the grid card), the task text, a due
  badge (`daysUntil`) or recurring status, and a `staging` badge. The **row body itself is the
  expand toggle** (batch-2 item 9): a single wide button — chevron + rank + badges + text —
  that opens/closes `ExpandedRow` on click or Enter/Space (`aria-expanded`); a leading chevron
  is the cue. Text edit is the secondary gesture: **double-click** (mouse) or **F2** (keyboard)
  swaps the text for an inline input (commit on Enter/blur, Esc cancels). Only two icon buttons
  sit in the trailing cluster — a **done control (`✓`, green)** and a **delete (`×`, red)** —
  both shared `IconButton`s (tooltip + hover intent); delete runs through `useConfirm` first
  (ListView), so it's no longer a silent soft-delete.
- **`ExpandedRow.tsx`** — the detail panel: urgency/importance sliders (0–100) each paired
  with a number input, a due-date picker, a **live** quadrant badge (tracks the sliders), and
  the recurring section (`RecurringSection` from `src/features/recurring/`).

## Slider commit semantics

Sliders/number inputs drive **local** state so the badge and thumb track live, but x/y are
only **committed on pointer-up / blur** — never on every input event (the grid must not jump
while you adjust). On commit, `ListRow` runs `resolveCollision(x, y, allTasks, id)`
(`src/lib/collision.ts`) and writes the non-overlapping spot via `useUpdateTask`. The date
picker commits `due` on change.

## Done control (normal vs. recurring)

The `✓` button branches on `task.recurring` (parity spec / EisenClaw `toggleDone`):

- **Normal task** → `useMarkTaskDone` (Done data-layer RPC). Writes today's `daily_state.done`
  + appends `history` in one transaction. The task drops off the list (filtered by
  `doneToday`) and shows in the Done tab.
- **Recurring task** → `useUpdateTask` writing `recurring.lastDoneAt = now` and
  `doneCount += 1`. This resets the cycle only — **no** `history`, **no** `daily_state` (a
  recurring task's done state lives in `lastDoneAt`). The card then reads "ok" and hides from
  the grid until its next cycle.

The recurring set/edit/remove controls live in the expanded row — see
`src/features/recurring/`.
