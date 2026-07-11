-- Migration: recurring reminders (fixed-cadence alarm) — lifts the "no reminders on recurring
-- tasks" bound from the 2026-07-09 pipeline.
--
-- Intent: a RECURRING task (a repeating chore or an ongoing project — both live in the `recurring`
-- jsonb) can now carry a push reminder that fires at a fixed TIME OF DAY on its cadence, e.g.
-- "take pill every day at noon". Product decision: FIXED-CADENCE ALARM — it fires at that time
-- every cycle INDEPENDENT of completion (marking the chore done does NOT skip or move the ping),
-- like a phone/medication alarm. Daily → every day; weekly/every-N → every N days at that time.
--
-- A recurring task has no fixed due instant to anchor to (recurrence is {frequencyDays, lastDoneAt}
-- and completion resets the clock), so a recurring reminder is anchored to a TIME OF DAY, not to an
-- offset-before-due. It reuses the existing pipeline row-for-row (the minute sweep, the exactly-once
-- claim, the inbox insert, web-push) — only the fire-time model and the re-arm differ:
--
--   • task_reminders gains `time_of_day time` (nullable). A row is exactly ONE kind — an XOR CHECK
--     forces exactly one of (offset_minutes, time_of_day) to be set. One-off rows keep
--     offset_minutes; recurring rows carry time_of_day and offset_minutes = NULL. A partial unique
--     index (task_id where time_of_day is not null) allows ONE recurring reminder per task (v1).
--   • next_recurring_fire_at() is the SOLE writer of a recurring fire_at (mirrors the reminder_fire_at
--     doctrine). It returns the next wall-clock occurrence of the time on the cadence grid that is
--     strictly after now(), advancing the wall-clock DATE (calendar-safe) and re-projecting through
--     AT TIME ZONE each step — so it stays at the same local time across DST, and a cron outage that
--     spans several cycles fires ONCE (it jumps straight to the next future slot, not the backlog).
--   • RE-ARM IS FOLDED INTO THE CLAIM. For a recurring row, claim_task_reminder ADVANCES fire_at to
--     the next occurrence (instead of setting sent_at). The advance-out-of-due-range IS the
--     exactly-once lock: an overlapping run re-evaluates its WHERE after the winner commits, sees
--     fire_at now in the future, `fire_at <= now()` fails → returns NULL → skips. sent_at stays NULL
--     so the series is immediately re-armed. Advancing BEFORE send means a crash between claim and
--     the message insert costs at most one occurrence's ping, but the series always survives.
--   • expire_stale_reminders ADVANCES recurring rows too (a row missed by >60 min is outside the
--     sweep's freshness window, so claim never runs on it — retiring it like a one-off would kill the
--     series). One-off stale rows still retire (sent_at := now()).
--   • due_task_reminders admits recurring rows and, for them, BYPASSES the done-today filter (a
--     fixed-cadence alarm fires regardless of completion; recurring completion writes
--     recurring.lastDoneAt, never daily_state.done, so the filter is moot anyway).
--   • Triggers: the due/due_time recompute is scoped to one-off rows (clearing a due date must not
--     wipe a recurring reminder); the timezone recompute handles BOTH kinds; a NEW recurring-change
--     trigger deletes the reminder when recurring is cleared and recomputes on a cadence change, but
--     is a NO-OP on a plain completion (lastDoneAt/doneCount) — the crux of the fixed-cadence rule.
--   • set_recurring_reminder / remove_recurring_reminder — the signed-in write path (INVOKER, RLS),
--     mirroring set_task_reminder / remove_task_reminder for the time-of-day kind.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.set_recurring_reminder(uuid, time);
--   drop function if exists public.remove_recurring_reminder(uuid);
--   drop trigger if exists task_reminders_recurring_change on public.tasks;
--   drop function if exists public.task_reminders_recurring_change_fn();
--   -- re-create due_task_reminders / claim_task_reminder / expire_stale_reminders /
--   --   task_reminders_recompute_fn / task_reminders_tz_recompute_fn from
--   --   20260709033335_task_reminders_pipeline.sql (+ the helper route from 20260709041944).
--   drop function if exists public.next_recurring_fire_at(timestamptz, time, int, text);
--   -- collapse/clear any recurring reminder rows before dropping the column, e.g.:
--   --   delete from public.task_reminders where time_of_day is not null;
--   drop index if exists public.task_reminders_recurring_key;
--   alter table public.task_reminders drop constraint if exists task_reminders_kind_ck;
--   alter table public.task_reminders alter column offset_minutes set not null;
--   alter table public.task_reminders drop column if exists time_of_day;
-- ----------------------------------------------------------------------------

-- ============================================================================
-- Schema: the time-of-day kind
-- ============================================================================
alter table public.task_reminders
  add column time_of_day time;

-- A recurring reminder carries no offset (there is no due to lead), so offset_minutes must be
-- nullable and each row is exactly one kind.
alter table public.task_reminders
  alter column offset_minutes drop not null;

-- Exactly one of (offset_minutes, time_of_day) is set — one-off XOR recurring. Existing rows all
-- have offset_minutes set + time_of_day null, so they satisfy it. (The existing 0..40320 range
-- check passes trivially on NULL; the existing unique(task_id, offset_minutes) is untouched —
-- recurring rows carry offset_minutes NULL, which is distinct under that constraint.)
alter table public.task_reminders
  add constraint task_reminders_kind_ck
  check ((offset_minutes is not null) <> (time_of_day is not null));

-- One recurring reminder per task (v1; several times-a-day is a follow-up).
create unique index task_reminders_recurring_key
  on public.task_reminders (task_id) where time_of_day is not null;

comment on table public.task_reminders is
  'Per-task push reminders (ADR 2026-07-09; multi-reminder 2026-07-11; recurring 2026-07-11). '
  'ONE-OFF rows carry offset_minutes and fire_at = (due + due_time in tz) − offset, materialized '
  'once and locked by sent_at. RECURRING rows carry time_of_day and fire_at = the next wall-clock '
  'occurrence on the task''s cadence (next_recurring_fire_at); claim ADVANCES fire_at each cycle '
  '(sent_at stays null) so the fixed-cadence alarm re-arms. An XOR check forces exactly one kind.';

-- ============================================================================
-- next_recurring_fire_at — the SOLE writer of a recurring fire_at
-- ============================================================================
-- The least instant of wall-clock `p_time` on the cadence grid (every p_freq days, phased off the
-- seed's local date) that is strictly after now(). DST-correct: it advances the wall-clock DATE and
-- re-projects through AT TIME ZONE each step (never +N*24h on the instant), so it holds the local
-- time across a DST change; and it jumps past a whole backlog (a cron outage spanning cycles fires
-- ONCE). STABLE for the same reason reminder_fire_at is (AT TIME ZONE resolves via tzdata).
create or replace function public.next_recurring_fire_at(
  p_seed timestamptz,
  p_time time,
  p_freq int,
  p_tz   text
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_tz   text := coalesce(p_tz, 'UTC');
  v_freq int  := greatest(coalesce(p_freq, 1), 1);
  v_date date := (p_seed at time zone v_tz)::date;
  v_fire timestamptz;
  k      int := 0;
begin
  loop
    v_fire := ((v_date + (k * v_freq))::timestamp + p_time) at time zone v_tz;
    exit when v_fire > now();
    k := k + 1;
    -- Safety backstop against a pathological seed (never hit for realistic cadences/outages).
    exit when k > 100000;
  end loop;
  return v_fire;
end;
$$;

-- ============================================================================
-- due_task_reminders — the minute sweep, now admitting recurring rows
-- ============================================================================
-- Return type changed (adds time_of_day, frequency_days), so DROP then re-create.
drop function if exists public.due_task_reminders();

create function public.due_task_reminders()
returns table (
  id             uuid,
  user_id        uuid,
  task_id        uuid,
  task_text      text,
  due            date,
  due_time       time,
  time_of_day    time,
  timezone       text,
  offset_minutes int,
  frequency_days int
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.user_id, t.id, t.text, t.due, t.due_time, r.time_of_day, us.timezone,
         r.offset_minutes, (t.recurring ->> 'frequencyDays')::int
    from public.task_reminders r
    join public.tasks t on t.id = r.task_id
    join public.user_schedule us on us.user_id = r.user_id
    left join public.daily_state ds
      on ds.user_id = r.user_id
     and ds.date = (now() at time zone us.timezone)::date
   where r.sent_at is null
     and r.fire_at <= now()
     and r.fire_at > now() - interval '60 minutes'
     and t.deleted_at is null
     and (
       -- one-off: a due date + time task, not recurring, not already done today
       (    r.offset_minutes is not null
        and t.recurring is null
        and t.due is not null
        and t.due_time is not null
        and coalesce((ds.done ->> t.id::text)::boolean, false) = false)
       -- recurring: fixed-cadence alarm — fires regardless of done-today
       or ( r.time_of_day is not null and t.recurring is not null)
     )
   order by r.fire_at;
$$;

-- ============================================================================
-- claim_task_reminder — the exactly-once send lock; recurring rows self-advance
-- ============================================================================
-- One-off: the UPDATE of sent_at is the lock (an overlapping run gets null and skips).
-- Recurring: ADVANCE fire_at to the next occurrence — `fire_at <= now()` in the WHERE is the lock
-- (the loser re-reads the advanced future fire_at and skips). sent_at stays null → re-armed.
create or replace function public.claim_task_reminder(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_time time;
  v_freq int;
  v_tz   text;
begin
  select r.time_of_day, (t.recurring ->> 'frequencyDays')::int, us.timezone
    into v_time, v_freq, v_tz
    from public.task_reminders r
    join public.tasks t on t.id = r.task_id
    join public.user_schedule us on us.user_id = r.user_id
   where r.id = p_id;

  if v_time is not null then
    update public.task_reminders
       set fire_at = public.next_recurring_fire_at(fire_at, v_time, v_freq, v_tz)
     where id = p_id and sent_at is null and fire_at <= now()
     returning id into v_id;
  else
    update public.task_reminders
       set sent_at = now()
     where id = p_id and sent_at is null
     returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- ============================================================================
-- expire_stale_reminders — one-off rows retire, recurring rows advance
-- ============================================================================
-- A row missed by >60 min is outside the sweep's freshness window, so claim never runs on it.
-- Retiring a recurring row (sent_at := now()) would kill the series, so recurring stale rows
-- ADVANCE to the next occurrence instead. Returns the total touched (logged by the dispatcher).
create or replace function public.expire_stale_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with retired as (
    update public.task_reminders
       set sent_at = now()
     where sent_at is null
       and time_of_day is null
       and fire_at <= now() - interval '60 minutes'
     returning 1
  ),
  advanced as (
    update public.task_reminders r
       set fire_at = public.next_recurring_fire_at(
                       r.fire_at, r.time_of_day,
                       (t.recurring ->> 'frequencyDays')::int, us.timezone)
      from public.tasks t, public.user_schedule us
     where r.time_of_day is not null
       and r.sent_at is null
       and r.fire_at <= now() - interval '60 minutes'
       and t.id = r.task_id
       and us.user_id = r.user_id
     returning 1
  )
  select (select count(*) from retired) + (select count(*) from advanced) into v_count;
  return v_count;
end;
$$;

-- ============================================================================
-- Triggers — fire_at can never go stale (now kind-aware)
-- ============================================================================
-- Due/due_time edit: recompute + re-arm ONE-OFF rows only. Clearing the date/time deletes the
-- one-off reminder, but must NOT touch a recurring reminder that happens to share the task.
create or replace function public.task_reminders_recompute_fn()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tz text;
begin
  if new.due is null or new.due_time is null then
    delete from public.task_reminders
     where task_id = new.id and offset_minutes is not null;
    return new;
  end if;

  select timezone into v_tz from public.user_schedule where user_id = new.user_id;

  update public.task_reminders
     set fire_at = public.reminder_fire_at(new.due, new.due_time, v_tz, offset_minutes),
         sent_at = null
   where task_id = new.id and offset_minutes is not null;

  return new;
end;
$$;

-- Timezone change: recompute PENDING fire times for BOTH kinds (same deadline, new clock). One-off
-- rows re-project through reminder_fire_at; recurring rows re-project the SAME wall-clock occurrence
-- (date + time_of_day) from the old zone into the new one.
create or replace function public.task_reminders_tz_recompute_fn()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.task_reminders r
     set fire_at = public.reminder_fire_at(t.due, t.due_time, new.timezone, r.offset_minutes)
    from public.tasks t
   where r.task_id = t.id
     and r.user_id = new.user_id
     and r.sent_at is null
     and r.offset_minutes is not null
     and t.due is not null
     and t.due_time is not null;

  update public.task_reminders r
     set fire_at = ((r.fire_at at time zone old.timezone)::date::timestamp + r.time_of_day)
                   at time zone new.timezone
   where r.user_id = new.user_id
     and r.time_of_day is not null;

  return new;
end;
$$;

-- Recurring change: keep the recurring reminder consistent with the task's cadence, but NEVER
-- re-arm on a plain completion. Cleared recurring → delete the reminder. Cadence (frequencyDays)
-- change → recompute to the next occurrence on the new cadence. Only lastDoneAt/doneCount/ongoing/
-- targetEnd changed (a completion or a project edit) → NO-OP: the fixed-cadence alarm is
-- independent of when the task was last done.
create or replace function public.task_reminders_recurring_change_fn()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tz text;
begin
  if new.recurring is null then
    delete from public.task_reminders
     where task_id = new.id and time_of_day is not null;
    return new;
  end if;

  if (old.recurring ->> 'frequencyDays') is distinct from (new.recurring ->> 'frequencyDays') then
    select timezone into v_tz from public.user_schedule where user_id = new.user_id;
    v_tz := coalesce(v_tz, 'UTC');

    update public.task_reminders r
       set fire_at = public.next_recurring_fire_at(
                       (((now() at time zone v_tz)::date)::timestamp + r.time_of_day)
                         at time zone v_tz,
                       r.time_of_day,
                       (new.recurring ->> 'frequencyDays')::int,
                       v_tz),
           sent_at = null
     where r.task_id = new.id and r.time_of_day is not null;
  end if;

  return new;
end;
$$;

create trigger task_reminders_recurring_change
  after update of recurring on public.tasks
  for each row
  when (old.recurring is distinct from new.recurring)
  execute function public.task_reminders_recurring_change_fn();

-- ============================================================================
-- set_recurring_reminder / remove_recurring_reminder — signed-in write path (INVOKER, RLS)
-- ============================================================================
-- Set (or re-arm) the caller's single recurring reminder for one of their own RECURRING tasks, at
-- wall-clock p_time_of_day, and return the materialized next fire_at. Raises if the task is
-- missing/not theirs or not recurring. The seed is today-at-the-time in the caller's timezone, so
-- the first fire is today (if the time is still ahead) or the next cadence day.
create or replace function public.set_recurring_reminder(p_task_id uuid, p_time_of_day time)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_recurring jsonb;
  v_freq      int;
  v_tz        text;
  v_seed      timestamptz;
  v_fire      timestamptz;
begin
  if p_time_of_day is null then
    raise exception 'time_required' using errcode = 'P0001';
  end if;

  -- RLS scopes this select to the caller's own live tasks; not-found ⇒ missing or not theirs.
  select recurring into v_recurring
    from public.tasks
    where id = p_task_id and deleted_at is null;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;
  if v_recurring is null then
    raise exception 'task_not_recurring' using errcode = 'P0001';
  end if;
  v_freq := (v_recurring ->> 'frequencyDays')::int;
  if v_freq is null or v_freq < 1 then
    raise exception 'task_missing_frequency' using errcode = 'P0001';
  end if;

  select timezone into v_tz from public.user_schedule where user_id = auth.uid();
  v_tz := coalesce(v_tz, 'UTC');
  v_seed := (((now() at time zone v_tz)::date)::timestamp + p_time_of_day) at time zone v_tz;
  v_fire := public.next_recurring_fire_at(v_seed, p_time_of_day, v_freq, v_tz);

  -- user_id omitted → column default auth.uid() + RLS WITH CHECK assign/enforce ownership.
  insert into public.task_reminders (task_id, time_of_day, fire_at, sent_at)
  values (p_task_id, p_time_of_day, v_fire, null)
  on conflict (task_id) where time_of_day is not null do update
    set time_of_day = excluded.time_of_day,
        fire_at     = excluded.fire_at,
        sent_at     = null;

  return v_fire;
end;
$$;

-- Remove the caller's recurring reminder for one of their own tasks (no-op if none / not theirs).
create or replace function public.remove_recurring_reminder(p_task_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.task_reminders where task_id = p_task_id and time_of_day is not null;
$$;

-- ============================================================================
-- Grants (re-issue the DEFINER sweep fns for service_role; new write RPCs for authenticated)
-- ============================================================================
revoke all on function public.due_task_reminders() from public;
grant execute on function public.due_task_reminders() to service_role;
revoke all on function public.claim_task_reminder(uuid) from public;
grant execute on function public.claim_task_reminder(uuid) to service_role;
revoke all on function public.expire_stale_reminders() from public;
grant execute on function public.expire_stale_reminders() to service_role;

grant execute on function public.set_recurring_reminder(uuid, time) to authenticated;
grant execute on function public.remove_recurring_reminder(uuid) to authenticated;
