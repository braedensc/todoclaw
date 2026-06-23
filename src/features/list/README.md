# list

Priority-ranked list view (Stage 3 PR5). Rows are the user's active tasks ordered by
`taskScore` descending — importance (y, 0.55) weighted above urgency (x, 0.45), plus a
due-soon bonus (`src/lib/scoring.ts`).

## Components

- **`ListView.tsx`** — orchestrator. Reads `useTasks` / `useUserSchedule` / `useDailyState`,
  excludes tasks already done today, **includes** staged tasks, sorts by score descending, and
  renders one `ListRow` per task. Owns the mutation wiring (`useUpdateTask`,
  `useSoftDeleteTask`); the row components stay presentational. Empty state when no active
  tasks remain.
- **`ListRow.tsx`** — one ranked row: quadrant-colored rank number + 4px left border, a
  recurring glyph badge (cadence + status in the tooltip, `src/lib/recurring.ts`),
  inline-editable text (click → input → commit on Enter/blur, Esc cancels), a due badge
  (`daysUntil`) or recurring status, a `staging` badge, an expand/collapse toggle, and a soft
  delete (`×`). **No done control** — marking done needs the Done data-layer RPC from a
  parallel PR and is wired in the next wave.
- **`ExpandedRow.tsx`** — the detail panel: urgency/importance sliders (0–100) each paired
  with a number input, a due-date picker, a **live** quadrant badge (tracks the sliders), and
  a recurring-section placeholder (PR8 fills it).

## Slider commit semantics

Sliders/number inputs drive **local** state so the badge and thumb track live, but x/y are
only **committed on pointer-up / blur** — never on every input event (the grid must not jump
while you adjust). On commit, `ListRow` runs `resolveCollision(x, y, allTasks, id)`
(`src/lib/collision.ts`) and writes the non-overlapping spot via `useUpdateTask`. The date
picker commits `due` on change.

## Not here yet

- Done checkbox (needs the Done data-layer RPC — next wave).
- Recurring set/remove controls (PR8; placeholder stub in `ExpandedRow`).
