# recurring

Recurring-task UI (Stage 3 PR8). The repeat-schedule control rendered inside an expanded list
row, plus the place where a task is **made / un-made** recurring. The recurring _math_
(status code, cadence label, colors) lives in `src/lib/recurring.ts` and is reused here, never
reimplemented.

A recurring task is a regular task with a `recurring` jsonb field
(`{ frequencyDays, lastDoneAt, doneCount }` — see `src/types/task.ts`). It is identical to a
normal task except: it surfaces on the grid only when due/soon/overdue, and marking it done
**resets its clock** instead of archiving it (handled in `src/features/list/`, not here).

## Ongoing projects (a separate task type)

An **ongoing project** — a standing, open-ended effort worked on over many sessions (e.g. "redesign
the site", "learn Spanish") — is **its own task type, not a flavor of recurring** (decoupled
2026-07-13). It is a standalone boolean column `tasks.ongoing` (migration
`20260713000000_ongoing_task_flag`), mutually exclusive with `recurring` (a DB CHECK enforces it).

An ongoing project behaves like a plain task: an optional (usually far-out) due date + time,
reminders, and marking it **done archives it** to the Done log exactly like a one-off. It has no
cadence, no check-in, no work-session tally, and no separate Finish — "finish" is just a normal
completion. Its ONE special property is the flag, which tells **Plan My Day** and **BabyClaw** to
proactively suggest chipping away at it (a no-deadline task the planner would otherwise never
surface). On the board it wears an `∞` "ongoing" badge (`ONGOING_GLYPH`, `src/lib/task-type.ts`);
`taskType(task)` in the same file is the shared discriminator.

The type is set in the shared `SchedulePanel`'s three-way **Task / Recurring / Ongoing** switch (the
parent handlers keep the two types exclusive in one write). BabyClaw sets it via `make_ongoing` (a
flag — just `task_id`) or `create_task`'s `ongoing` boolean, and clears it via `clear_recurring` —
see `supabase/functions/_shared/capabilities/tasks.ts`.

## Reminders (offset before each occurrence)

A recurring **chore** carries reminders the **same way a one-off does** — lead-time **offsets**
(unified 2026-07-12): "remind me 1 hour before". The difference is only where the offset anchors: a
one-off (or an ongoing project — it is a plain task for reminders) leads its single due instant,
while a recurring chore leads **each occurrence** on its cadence (anchored to the task's `due` date +
`due_time`), re-arming every cycle **regardless of completion**. So the recurring editors show the SAME `ReminderPicker` (offset chips),
gated on a due time, with a one-line "before each time it comes back" note. A recurring task must
therefore have a due date + time to carry a reminder (the due date = the first/anchor occurrence).
Writes go through `useTaskReminders` / `useTaskReminderWrites`
(`src/features/reminders/use-task-reminders.ts`) → the `set_task_reminder` / `remove_task_reminder`
/ `clear_task_reminder` RPCs. BabyClaw sets them via the `set_reminder` capability (recurring tasks
now accepted). The fire-time math is `next_recurring_fire_at` (SQL, the sole production writer) /
`nextRecurringFireAt` (`src/lib/recurring-reminders.ts`, unit-tested): the next occurrence − offset,
DST-safe and backlog-skipping. Full design: ADR
`docs/adr/2026-07-09-task-reminders-pg-cron-push.md` (recurring unified 2026-07-12).

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
