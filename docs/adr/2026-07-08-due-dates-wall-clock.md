# ADR 2026-07-08 — Due dates are wall-clock: floating DATE + optional local TIME

**Date:** 2026-07-08 · **Post-launch** (reminders roadmap, PR 1 of 6)

`tasks.due` was `timestamptz`, but every writer (date picker, chat `set_due_date`) stores a bare
`'YYYY-MM-DD'` — persisted as midnight UTC and returned by PostgREST as
`'2026-05-27T00:00:00+00:00'`. PR #178 taught client scoring to treat a *bare* date string as a
floating calendar date, but the timestamptz wire format misses that branch, so a persisted task
still read as overdue on its own due date west of UTC. Separately, the reminders feature needs
times-of-day ("dentist at 10:30"), which an instant-typed column models badly.

**Decision — due dates are wall-clock values, never instants:**

- `due` becomes a Postgres `date` (floating calendar date — the day the user picked); new
  nullable `due_time time` is the optional local clock time. Both are interpreted in
  `user_schedule.timezone`, the same authority as the daily reset. A CHECK forbids a time
  without a date.
- **Why wall-clock over a UTC instant + flag:** "10:30" must stay 10:30 across DST shifts and
  timezone moves, date-only tasks stay a *day* rather than a fake midnight, and the `date` wire
  format (`'2026-05-27'`) makes every reader take #178's floating-date path — completing that
  fix structurally. Cost: a projection is needed at the edges.
- `dueInstant(due, due_time, timeZone)` (src/lib/dates.ts, pure Intl, DST-deterministic) is the
  ONLY place a due becomes an instant — countdown chips and reminder `fire_at` computation.
- Server-side day-diff math is hoisted to one `daysUntilInTZ` in `_shared/dates.ts` (was three
  drifting copies in placement / chat-context / plan-inputs, all still carrying the pre-#178
  parse) and `restore_backup` restores both snapshot vintages (`left(...,10)::date`) and
  round-trips `due_time`.
- **Unchanged:** the priority-score formula and its date-granular `daysUntil <= 2` bonus;
  recurring cadence math (`lastDoneAt` is a real instant and stays timestamptz).
