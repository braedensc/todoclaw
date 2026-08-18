# Scheduling one occurrence of a recurring chore: an explicit `nextDueOn`

**Status:** Accepted

## Context

"I need to do laundry tomorrow" — said to BabyClaw about a weekly chore — had no working mechanism.

A recurring chore's due-ness is **derived**: `recurringStatus` computes
`daysLeft = frequencyDays - daysSince(lastDoneAt)`, and every board and planning surface (~11 of
them) reads that one function. Nothing consulted a chosen day, so:

- setting a **due date** did nothing visible. On a chore `tasks.due`/`due_time` are the *reminder
  occurrence anchor* — `next_recurring_fire_at` phases off them and never advances them — so a chore
  carrying a reminder holds a `due` receding into the past. Reading that as a deadline pins the chore
  to the board reading ever-more overdue, which is why it was tried and reverted (#348).
- the shipped alternative **phased the cadence clock**: write `lastDoneAt = midnight(targetDay) −
  frequencyDays` so the derived status lands on the wanted day (`lastDoneAtForOccurrenceOn`,
  exposed as `schedule_for_day`).

Phasing worked and needed no reader changes, but it had two real costs:

1. **It fabricated history.** `lastDoneAt` means "when this was last completed" and is read as fact
   by `recurringDoneToday` (the board's done-today hide), the Done log, and the activity log. Phasing
   overwrote the true value with a synthetic one, irreversibly.
2. **A one-off request permanently re-phased the cadence.** Every later cycle counted from the
   fabricated date, so "do it Friday" moved the user's weekly slot to Fridays for good.

Two further seams made the area hard to reason about: the cadence ladder was implemented **three**
times (client, `plan-inputs.ts`, `chat-context.ts`) and had already diverged (`due again in 4d` vs
`in 4d` for the same state), and the plan card's "chores due today" strip decided membership by
**string-matching a display label** (`status === 'due today' || startsWith('overdue')`) because the
structured `code` was discarded at the request boundary.

## Decision

Add an explicit **`recurring.nextDueOn`** — a wall-clock `'YYYY-MM-DD'` in the user's timezone
meaning *"this occurrence is wanted on this day"*.

- `recurringStatus` reads it **first**, falling back to the cadence clock. Both branches run through
  the same `statusFromDaysLeft` ladder, so an override is indistinguishable downstream: **every
  existing reader honors it with no change of its own.**
- It is a **one-shot**. `recurringCompletion` clears it, so the cadence resumes from the *real*
  completion instant and the user's rhythm is never moved. It additionally **retires at read time**
  when `lastDoneAt` lands on or after the scheduled day — self-healing with no cron, the same shape
  as `start_date`/`isDormant` — so a writer that forgets can't pin a chore to "due today" forever.
- Override math is **calendar-day** (`daysUntil`), not the cadence clock's rolling 24h, so it can't
  drift on a 23- or 25-hour DST day.
- It lives in the existing `recurring` jsonb as an optional `.nullish()` field: **no migration**, and
  rows written before it simply lack it.

Adopted alongside it, because they are what made the area confusing:

- The cadence ladder now lives in exactly **two** places — `src/lib/recurring.ts` and
  `supabase/functions/_shared/recurring-status.ts`. Two, not one, only because the frontend and Deno
  trees cannot import from each other; their literal label expectations are the lockstep, pinned by
  both test files. `chat-context.ts` keeps its roomier prose but derives the arithmetic from the
  shared ladder.
- `recurringDue` entries carry **`daysLeft`**, and `deriveChores` selects on that number
  (`daysLeft <= 0`). The label branch survives only as a documented deploy-skew shim. `deriveChores`
  also **sorts before capping**, so a backlog over `MAX_CHORES` drops the least overdue rather than
  an arbitrary chore.
- `recurringStatus` now **requires** a `timeZone` (matching `ScoringOpts`), threaded through the 11
  call sites plus `CollisionOpts`. A wall-clock day has to be read against the same authority as the
  daily reset, and a silent browser-zone fallback is exactly the fuzziness this ADR removes.
- The schedule editor's calendar writes `nextDueOn` **and** `due` to the same day on a chore (inside
  `useSetDueWithDefaultReminder`, the one chokepoint every existing-task due write already routes
  through — #305), so the occurrence and its reminder stop being two independent schedules, and all
  five schedule surfaces get it at once. Its header reads "Do it on a day" for a chore, not "Set a
  due date".
- `chat-prompt.ts`'s `taskLine` no longer reports a chore's anchor as a deadline. Emitting a bare
  "due today" there is why the user believed laundry *was* due today while every board surface
  correctly hid it.

## Consequences

- `lastDoneAtForOccurrenceOn` and `_shared/recurring-schedule.ts` are deleted. `restore_task` now
  does a **pure** one-cadence rewind of the stored stamp, so a completion restored two days late
  reads `overdue 2d` instead of being forced onto today.
- `schedule_for_day` onto a day the chore was **already completed on** is now a reported no-op (the
  override would retire against that very completion). The supported way to get an extra same-day
  round is `restore_task`, which the tool description now says.
- One behavior is deliberately given up: phasing could produce an extra same-day round *by erasing
  the completion*. That was the fabrication, not a feature.
- `#349`'s pins all still hold — "a chore's reminder anchor is not a deadline" remains true, and is
  now also true of what BabyClaw *says*.
