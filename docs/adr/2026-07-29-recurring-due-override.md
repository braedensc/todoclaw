# ADR 2026-07-29 — A due date on a recurring task is a one-off override of its cadence

**Date:** 2026-07-29 · **Post-launch** (bug report from the owner's own board) · **Status:** Accepted · extends the wall-clock due model of [ADR 2026-07-08](2026-07-08-due-dates-wall-clock.md)

`tasks.due` and `tasks.recurring` could always be set on the same row — the schedule editor
offers a date picker and a Recurring type switch side by side, and BabyClaw's `set_due_date`
accepted a recurring task without complaint. But **nothing read `due` on a recurring row.** Every
reader keyed off the cadence clock alone (`recurringStatus` = `frequencyDays - daysSinceLastDone`):
the grid's `isPlaced` gate, the list/card status badge (which renders *instead of* the due chip),
both `buildPlanRequest` twins, and BabyClaw's chat context.

So a user who had just ticked off their weekly laundry and wanted it back for one extra load
could set a due date, watch the app confirm the write, and see nothing change anywhere: the card
still read "in 7d", the board still hid it, and Plan My Day still skipped it. The write landed in
the column and died there. Three rounds of chat couldn't fix it, because there was no combination
of due date and importance that any reader would honor.

## Decision — the nearer of the two clocks wins

A due date on a recurring task is a **deadline for the current occurrence**: "the cadence says
next week, but this one needs doing today." The cadence remains the standing schedule; the due
date is a one-time pull-forward.

- **Status** = `statusFromDaysLeft(min(cadenceDaysLeft, daysUntil(due)))` —
  `recurringTaskStatus` in `src/lib/recurring.ts`, mirrored in `_shared/plan-inputs.ts` and
  `_shared/chat-context.ts`. Taking the **nearer** clock (never simply "due wins") is what makes
  the rule safe: a far-out deadline can't push a chore its own cadence already calls overdue out
  of sight.
- **A live deadline beats the done-today hide** (`recurringDueLive`). Completing a recurring task
  normally hides it for the rest of the local day so "done" reads as something. The only way to
  be done-today *and* due-today is to set the deadline **after** ticking it off — a deliberate
  "another one, today" — so the board, the mobile matrix, and BabyClaw's ACTIVE block all honor it.
- **Completing consumes the override**: every recurring-completion write site clears `due` and
  `due_time` alongside the `lastDoneAt`/`doneCount` advance. Without this, a spent deadline would
  read overdue forever and the chore could never return to its plain cadence.

Because the override rides on the existing `due` column, no migration is needed and the paused
(`start_date`) gate is untouched — a dormant chore sits out its pause, deadline or not.

## Rejected

- **Forbidding a due date on a recurring task** (hide the picker, have `set_due_date` refuse).
  Honest and simpler, but it answers "I need this chore today" with "make a second task", which
  is exactly the bookkeeping the planner exists to avoid.
- **Due wins outright, ignoring the cadence.** One line shorter, and it silently mutes overdue
  chores the moment a later deadline is attached.
- **Auto-bumping importance to surface the task** (what BabyClaw first reached for). A deadline
  says *when*, never *how much it matters* — the same placement doctrine `set_due_date` already
  follows by re-deriving urgency (x) and never importance (y).

## Consequences

- **Any new reader of a recurring task's schedule must use `recurringTaskStatus`, not
  `recurringStatus`.** The cadence-only function stays exported as its building block; the only
  remaining direct callers are `recurringStatusWithDue` and `collision.ts`'s timezone-free path.
- Three homes must stay in step, as with every other cross-tree rule: `src/lib/recurring.ts`,
  `supabase/functions/_shared/plan-inputs.ts`, and `_shared/chat-context.ts`.
- `restore_task` was fixed in the same pass — it called `set_task_undone`, which clears today's
  daily done **map**, but a recurring completion never enters that map (it advances `lastDoneAt`).
  The tool wrote nothing while replying that the task was restored. It now rewinds the cycle one
  cadence and un-counts the completion.
- `set_due_date`'s tool description now states the recurring semantics outright, so BabyClaw
  proposes the due date instead of talking the user out of it.
