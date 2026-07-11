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
