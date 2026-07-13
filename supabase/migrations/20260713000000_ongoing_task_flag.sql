-- Migration: decouple ONGOING projects from the recurring engine onto their own flag (2026-07-13).
--
-- Intent: an "ongoing project" was modeled as a recurring task carrying `recurring.ongoing = true`
-- (plus a check-in `frequencyDays` cadence, a `doneCount` session tally, and an optional
-- `targetEnd`). Product decision (2026-07-13): the three task types are now first-class + distinct —
--   • TASK      — one-off; due/time + reminders; marking done archives it (completed_at).
--   • RECURRING — a chore; a cadence + reminders; marking done resurfaces it (UNCHANGED here).
--   • ONGOING   — a standing, open-ended effort with an optional (usually far-out) due date; it
--                 behaves like a plain task (due/time + reminders, done archives), and its ONLY
--                 special property is a flag that tells Plan My Day / BabyClaw to proactively
--                 suggest chipping away at it. No check-in cadence, no session tally, no separate
--                 Finish — "finish" is just a normal completion.
--
-- So ongoing stops piggy-backing on the `recurring` jsonb and gets its own boolean column. That is
-- what lets Plan My Day stop filtering it out (it is no longer `recurring`), lets `done` archive it
-- (no phantom work-session), and keeps it from hiding/resurfacing on a cadence.
--
-- Data migration: every existing ongoing project (recurring->>'ongoing' = 'true') becomes
-- `ongoing = true` with `recurring = null`; its soft `targetEnd` is promoted to a real `due` date
-- when the task has none (so the target survives as the deadline). The dropped `frequencyDays` /
-- `doneCount` (check-in cadence + session count) are intentionally discarded — the new model has no
-- such concept. Clearing `recurring` fires the existing task_reminders_recurring_change trigger,
-- which re-anchors any reminders from the recurring fire-time formula to the one-off one.
--
-- ----------------------------------------------------------------------------
-- Down path (manual — the discarded cadence/session data cannot be recovered):
--   alter table public.tasks drop constraint if exists tasks_type_exclusive_ck;
--   alter table public.tasks drop column ongoing;
--   -- (pre-existing ongoing projects would then need recurring.ongoing re-set by hand.)
-- ----------------------------------------------------------------------------

alter table public.tasks
  add column ongoing boolean not null default false;

comment on column public.tasks.ongoing is
  'TRUE marks an ONGOING project (2026-07-13): a standing, open-ended effort that behaves like a '
  'plain task (optional due/time + reminders, completion archives it) but carries a flag telling '
  'Plan My Day / BabyClaw to proactively suggest working on it. Mutually exclusive with a recurring '
  'chore (see tasks_type_exclusive_ck). Replaces the old recurring.ongoing jsonb key.';

-- Promote existing ongoing projects off the recurring jsonb onto the flag. RHS expressions read the
-- pre-update row, so `recurring ->> 'targetEnd'` still sees the target before recurring is cleared.
update public.tasks
   set ongoing   = true,
       due       = coalesce(due, recurring ->> 'targetEnd'),
       recurring = null
 where recurring ->> 'ongoing' = 'true';

-- The three types are exclusive: a task is at most ONE of recurring (chore) / ongoing (project).
alter table public.tasks
  add constraint tasks_type_exclusive_ck
  check (not (ongoing and recurring is not null));
