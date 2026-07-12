# ADR 2026-07-09 — Per-task reminders: materialized fire times + an in-database minute cron

**Date:** 2026-07-09 · **Post-launch** (reminders roadmap, PR 4 of 6)

Tasks now carry wall-clock due times (ADR 2026-07-08-due-dates-wall-clock); users want "buzz me
1 hour before" (workshop, approved 2026-07-08). The push transport, subscription store, inbox,
and claim-RPC idempotency pattern all exist (ADR-0031) — what was missing is a *scheduler* finer
than the hourly GitHub-Actions cron and a *schedule* to sweep.

**Decision — materialize the instant, sweep it every minute, reuse the push stack:**

- **`task_reminders` stores a materialized `fire_at`** — `(due + due_time) AT TIME ZONE
  user_schedule.timezone − offset` — rather than evaluating wall-clock math per sweep. Two
  triggers keep it honest at the only write paths: a due/due_time edit recomputes and RE-ARMS
  (`sent_at := null` — the old send was for the old deadline; clearing date/time deletes the
  row); a timezone change recomputes pending rows only (same deadline, new clock — the
  timezone-clarity save is the single choke point). DST is Postgres's per-date tz rules.
- **pg_cron + pg_net** (the upgrade path ADR-0031 explicitly reserved): a `* * * * *` job POSTs
  to the new `dispatch-reminders` Edge Function. URL + shared secret come from **Vault**
  (`dispatch_reminders_url`, `dispatch_secret`) and the job no-ops until both exist — local
  stacks and fresh environments stay silent; one-time owner setup is two `vault.create_secret`
  calls. Digests keep the hourly GH cron; alternatives rejected: 1-minute GH Actions (unreliable
  scheduling, burns minutes), client timers (tab must be open).
- **Delivery = the ADR-0031 pipeline verbatim**: claim exactly-once (`claim_task_reminder`'s
  UPDATE is the send lock), durable `messages` row (new kind `'reminder'`; the daily
  `unique(user_id, local_date, kind)` becomes a partial index over plan/recap and
  `claim_message` names that predicate), `sendWebPush` + dead-endpoint pruning. Content is
  deterministic (`reminder-content.ts`) — zero AI tokens, no budget interaction.
- **Product rules** (Braeden's calls, 2026-07-08): reminders fire **through quiet hours** (an
  explicit per-task ask, unlike ambient digests); a reminder more than **60 minutes late is
  expired unsent** (an hour-late alarm is noise — the overdue glow already tells the story);
  the sweep skips deleted, recurring, and done-today tasks at read time.
- **v1 bounds:** one reminder per task (`unique(task_id)` — editors upsert + re-arm; dropping
  the constraint later admits several), no reminders on recurring tasks or date-only tasks
  (no instant to anchor), no snooze actions.
  - **Update 2026-07-11 — multi-reminder:** the one-per-task bound is lifted (the "later" above).
    A task may now hold several reminders at distinct lead times (e.g. 1 day AND 1 hour before):
    `unique(task_id)` → `unique(task_id, offset_minutes)`; `set_task_reminder` upserts a single
    offset and `remove_task_reminder(task_id, offset)` deletes one (`clear_task_reminder` still
    drops them all). The sweep/claim/trigger/dispatch pipeline was already per-row, so each
    reminder simply fires on its own — no other changes. See migration
    `20260711000000_multi_task_reminders.sql`. The recurring/date-only/no-snooze bounds still hold.
  - **Update 2026-07-11 — recurring reminders (fixed-cadence alarm):** _[SUPERSEDED 2026-07-12 —
    see the next entry. The `time_of_day` column, its XOR CHECK, the partial unique index, and
    `set/remove_recurring_reminder` described here were all retired by
    `20260712000000_recurring_reminders_unify.sql`. Kept for provenance.]_ the "no reminders on
    recurring tasks" bound is lifted. A recurring task (chore or ongoing project) can carry ONE
    reminder anchored to a **time of day** — "take pill every day at noon" — that fires at that
    time on the task's cadence **regardless of completion** (a fixed alarm, not tied to
    `lastDoneAt`; product decision, owner-approved). A recurring task has no fixed due instant, so
    the model diverges from the offset-before-due reminder:
    - **Schema:** a nullable `time_of_day` column; `offset_minutes` becomes nullable; a CHECK forces
      exactly one of the two (one-off XOR recurring); a partial `unique(task_id) where time_of_day
      is not null` caps it at one recurring reminder per task (several-a-day is a follow-up).
    - **`next_recurring_fire_at()`** is the sole writer of a recurring `fire_at`: the next wall-clock
      occurrence on the cadence grid, advancing the DATE and re-projecting through `AT TIME ZONE`
      (DST-correct), skipping a whole backlog so a cron outage fires ONCE.
    - **Re-arm is folded into the claim:** for a recurring row `claim_task_reminder` ADVANCES
      `fire_at` to the next occurrence instead of setting `sent_at` — and the advance-out-of-range
      IS the exactly-once lock (an overlapping run re-reads the future `fire_at` and skips).
      `expire_stale_reminders` likewise advances recurring rows (retiring them would kill the
      series). The sweep admits recurring rows and, for them, bypasses the done-today filter.
    - **Triggers:** the due/due_time recompute is scoped to one-off rows; the timezone recompute
      handles both kinds; a new recurring-change trigger deletes the reminder when recurring is
      cleared and recomputes on a cadence change, but is a NO-OP on a plain completion (this is what
      keeps a fixed alarm from re-arming when you mark the chore done early).
    - **Write path:** `set_recurring_reminder(task_id, time_of_day)` / `remove_recurring_reminder`
      (INVOKER, RLS), the `set_recurring_reminder` chat capability, and a "Remind me at" time-of-day
      control on the recurring editors. See migration `20260711010000_recurring_reminders.sql`. The
      date-only and no-snooze bounds still hold.
  - **Update 2026-07-12 — recurring reminders unified onto the offset model:** the separate
    time-of-day alarm above is retired; a recurring task's reminders are now the SAME `offset_minutes`
    lead times as a one-off, anchored to the task's `due` date + `due_time` (the due date = the
    first/anchor occurrence). A reminder fires the chosen offset before the **next occurrence** on
    the cadence and re-arms each cycle (still fixed-cadence — the occurrence grid is anchored to
    `due`, never to `lastDoneAt`, so completion never moves it). This kills the second time
    vocabulary and makes the calendar the `SchedulePanel` already showed on a recurring task mean
    something (owner-approved, option A). Changes: the `time_of_day` column / XOR CHECK / partial
    unique index and `set/remove_recurring_reminder` are dropped; `next_recurring_fire_at(due, time,
    freq, offset, tz)` returns `occurrence − offset` (keeps the DST-safe, backlog-skipping math and
    the advance-on-claim re-arm); `set_task_reminder` now accepts a recurring task (kind is the
    task's `recurring`, no longer stored on the row) and `unique(task_id, offset_minutes)` lets a
    recurring task hold several offsets; the pipeline (sweep/claim/expire/triggers) branches on
    `tasks.recurring`; the UI shows the one `ReminderPicker` on both kinds and the `set_reminder`
    chat capability handles recurring. `RecurringReminderPicker` is deleted. The ~1-day-old
    `time_of_day` rows are cleared by the migration. See
    `20260712000000_recurring_reminders_unify.sql`. Date-only and no-snooze bounds still hold.
