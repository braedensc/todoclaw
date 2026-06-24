# recurring

Recurring-task UI (Stage 3 PR8). The repeat-schedule control rendered inside an expanded list
row, plus the place where a task is **made / un-made** recurring. The recurring _math_
(status code, cadence label, colors) lives in `src/lib/recurring.ts` and is reused here, never
reimplemented.

A recurring task is a regular task with a `recurring` jsonb field
(`{ frequencyDays, lastDoneAt, doneCount }` — see `src/types/task.ts`). It is identical to a
normal task except: it surfaces on the grid only when due/soon/overdue, and marking it done
**resets its clock** instead of archiving it (handled in `src/features/list/`, not here).

## Components

- **`RecurringSection.tsx`** — the `↻ Recurring` row at the bottom of `ExpandedRow`. Owns no
  server state; it reads `task.recurring` and calls back into the parent's mutation wiring
  (`ListView`'s `useUpdateTask`). Two modes:
  - **Not recurring** → a days number-input + **Set** (writes a fresh
    `{ frequencyDays, lastDoneAt: null, doneCount: 0 }`). Set is a no-op until a positive
    integer is entered.
  - **Recurring** → the cadence via `fmtFrequency`, the live status via `recurringStatus`
    (label colored by `RC_COLOR[code]`), an editable frequency input (preserves `lastDoneAt` +
    `doneCount`), and **Remove** (writes `recurring: null`).

## Where the rest lives

- **Status/cadence/colors:** `src/lib/recurring.ts` (`recurringStatus`, `RC_COLOR`,
  `fmtFrequency`) — fully unit-tested in `recurring.test.ts`.
- **Mark-done branch + the set/remove mutation handlers:** `src/features/list/ListView.tsx`
  (recurring done = `useUpdateTask` cycle reset; normal done = `useMarkTaskDone`). The
  `RecurringSection` and done-control behavior are tested in `ListView.test.tsx`.
- **Grid visuals** (`code !== 'ok'` visibility filter, `×N` badge): `src/features/grid/`. The
  list row mirrors the same `×N` badge at `doneCount ≥ 3`.
