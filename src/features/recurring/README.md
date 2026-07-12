# recurring

Recurring-task UI (Stage 3 PR8). The repeat-schedule control rendered inside an expanded list
row, plus the place where a task is **made / un-made** recurring. The recurring _math_
(status code, cadence label, colors) lives in `src/lib/recurring.ts` and is reused here, never
reimplemented.

A recurring task is a regular task with a `recurring` jsonb field
(`{ frequencyDays, lastDoneAt, doneCount }` — see `src/types/task.ts`). It is identical to a
normal task except: it surfaces on the grid only when due/soon/overdue, and marking it done
**resets its clock** instead of archiving it (handled in `src/features/list/`, not here).

## Ongoing projects (same engine, project framing)

A month-long effort worked on continuously (e.g. "redesign the site") is an **ongoing project** —
the same `recurring` jsonb with two extra keys, `ongoing: true` and an optional `targetEnd`
(`'YYYY-MM-DD'`). It reuses the whole engine: `frequencyDays` becomes the **check-in cadence** (how
often it resurfaces), `lastDoneAt`/`doneCount` become the last work session / **session count**, and
`recurringStatus` still drives the hide-when-`ok` + color. The differences from a chore:

- The ✓ **logs a work session** (advances the cycle), same code path as a recurring done.
- It has a terminal **Finish** (in the expanded row's schedule editor) that archives it to the Done
  log via the shared `set_task_done` RPC — the finish line a plain repeat never reaches.
- It reads as a project: `▶` glyph, a session tally, and a target-end countdown from
  `ongoingLabel` (`src/lib/recurring.ts`) instead of a `↻` cadence.

No migration is needed (the keys live in the jsonb); a row without `ongoing` is byte-for-byte the
old chore behavior. Config lives in the shared `SchedulePanel` (list expanded row) as a "Make it an
ongoing project" toggle → the check-in stepper, target-end, and Finish. BabyClaw can also set it
(`make_ongoing` / `finish_ongoing`, and `create_task`'s ongoing fields) — see
`supabase/functions/_shared/capabilities/tasks.ts`.

## Reminders (fixed-cadence alarm)

A recurring task (chore or ongoing project) can carry ONE **time-of-day reminder** — "remind me to
take my pill every day at noon". Unlike a one-off reminder (which fires a lead time before a due
instant), a recurring reminder is a **fixed alarm**: it fires at the chosen wall-clock time on the
task's cadence, **every cycle, regardless of completion**. It needs no due date — it anchors to a
time of day, not a due instant. The "Remind me at" time-of-day control (`RecurringReminderPicker`)
lives in the shared `SchedulePanel` on the recurring editors (grid card ⋯ menu, list expanded row);
writes go through `useRecurringReminder` / `useRecurringReminderWrites`
(`src/features/reminders/use-task-reminders.ts`) → the `set_recurring_reminder` /
`remove_recurring_reminder` RPCs. BabyClaw can set it too (`set_recurring_reminder` capability). The
fire-time math is `next_recurring_fire_at` (SQL) / `nextRecurringFireAt`
(`src/lib/recurring-reminders.ts`, unit-tested). Full design: ADR
`docs/adr/2026-07-09-task-reminders-pg-cron-push.md` (2026-07-11 update).

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
