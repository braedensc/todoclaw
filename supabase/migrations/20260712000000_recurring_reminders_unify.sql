-- Migration: unify recurring reminders onto the one-off OFFSET model (2026-07-12).
--
-- Intent: #231 (20260711010000) gave a recurring task a SEPARATE reminder concept — a fixed
-- time-of-day ALARM stored in task_reminders.time_of_day, anchored to no due date. That created a
-- second time vocabulary and left the calendar + due time the SchedulePanel already shows on a
-- recurring task vestigial. Owner-approved unify (option A): a recurring task's `due` + `due_time`
-- become the reminder ANCHOR (the first/anchor occurrence), the cadence repeats from there, and a
-- reminder fires a chosen lead-time OFFSET before the next occurrence — exactly like a one-off,
-- only the occurrence repeats. Recurring and one-off now share task_reminders.offset_minutes, the
-- ReminderPicker, and the message copy; the only difference is which fire-time formula applies:
--
--   • ONE-OFF row (task.recurring IS NULL):     fire_at = reminder_fire_at(due, due_time, tz, offset)
--   • RECURRING row (task.recurring IS NOT NULL): fire_at = next_recurring_fire_at(due, due_time,
--       frequencyDays, offset, tz) — the next occurrence on the cadence grid, minus the offset.
--
-- The KIND is no longer stored on the reminder row (the XOR check + time_of_day column go away): it
-- is derived from the task's `recurring`. Both kinds carry offset_minutes; the #227
-- unique(task_id, offset_minutes) already permits MULTIPLE offsets per task, so a recurring task
-- can now hold "1 day" AND "1 hour" before each occurrence — the one-per-task limit is retired.
--
-- next_recurring_fire_at keeps #231's DST-safe, backlog-skipping next-occurrence math and the
-- advance-on-claim re-arm (the fixed-cadence alarm still fires every cycle regardless of
-- completion, because the occurrence grid is anchored to `due`, never to lastDoneAt) — only its
-- signature changes (it now takes the anchor date + offset and returns occurrence − offset).
--
-- The ~1-day-old #231 time_of_day reminder rows cannot be re-anchored (their tasks may carry no due
-- date), so this migration CLEARS them; affected users simply re-add a reminder from the picker.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal — restores the #231 time-of-day model):
--   -- 1. re-add the schema:
--   alter table public.task_reminders alter column offset_minutes drop not null;
--   alter table public.task_reminders add column time_of_day time;
--   alter table public.task_reminders add constraint task_reminders_kind_ck
--     check ((offset_minutes is not null) <> (time_of_day is not null));
--   create unique index task_reminders_recurring_key
--     on public.task_reminders (task_id) where time_of_day is not null;
--   -- 2. drop this migration's offset-signature helper, then re-create every function/trigger and
--   --    the set/remove_recurring_reminder RPCs from 20260711010000_recurring_reminders.sql:
--   drop function if exists public.next_recurring_fire_at(date, time, int, int, text);
--   -- (re-run 20260711010000 bodies: next_recurring_fire_at(timestamptz,time,int,text),
--   --  due_task_reminders, claim_task_reminder, expire_stale_reminders,
--   --  task_reminders_recompute_fn, task_reminders_tz_recompute_fn,
--   --  task_reminders_recurring_change_fn, set/remove_recurring_reminder, and set_task_reminder
--   --  from 20260711000000_multi_task_reminders.sql which re-forbids recurring.)
-- ----------------------------------------------------------------------------

-- ============================================================================
-- next_recurring_fire_at — the SOLE writer of a recurring fire_at (now offset-based)
-- ============================================================================
-- The least `(occurrence − offset)` strictly after now(), where occurrences are wall-clock p_time
-- on the cadence grid — every p_freq days, phased off the anchor `p_due` date — projected through
-- AT TIME ZONE. DST-correct (advances the wall-clock DATE and re-projects each step, never +N*24h
-- on the instant, so it holds local time across a DST change) and backlog-skipping (a cron outage
-- spanning cycles fires ONCE — it jumps to the next future slot). A lead time that has already
-- elapsed arms the NEXT occurrence rather than firing late. STABLE (AT TIME ZONE resolves via
-- tzdata). The old (timestamptz seed) signature is dropped — this one takes the anchor + offset.
drop function if exists public.next_recurring_fire_at(timestamptz, time, int, text);

create or replace function public.next_recurring_fire_at(
  p_due    date,
  p_time   time,
  p_freq   int,
  p_offset int,
  p_tz     text
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_tz     text := coalesce(p_tz, 'UTC');
  v_freq   int  := greatest(coalesce(p_freq, 1), 1);
  v_offset int  := greatest(coalesce(p_offset, 0), 0);
  v_occ    timestamptz;
  v_fire   timestamptz;
  k        int := 0;
begin
  if p_due is null or p_time is null then
    return null;  -- no anchor ⇒ no reminder (the picker is gated on a due time; defensive here)
  end if;
  loop
    v_occ  := ((p_due + (k * v_freq))::timestamp + p_time) at time zone v_tz;
    v_fire := v_occ - make_interval(mins => v_offset);
    exit when v_fire > now();
    k := k + 1;
    -- Safety backstop against a pathological anchor (never hit for realistic cadences/outages).
    exit when k > 100000;
  end loop;
  return v_fire;
end;
$$;

-- ============================================================================
-- due_task_reminders — the minute sweep (both kinds carry offset_minutes; kind is task.recurring)
-- ============================================================================
-- Return type reverts to the one-off shape (time_of_day / frequency_days are gone), so DROP then
-- re-create. Both kinds now require due + due_time (the shared anchor). A recurring row fires
-- regardless of completion (recurring completion writes recurring.lastDoneAt, never
-- daily_state.done, so the done filter is moot for it anyway); a one-off row is excluded once done
-- today.
drop function if exists public.due_task_reminders();

create function public.due_task_reminders()
returns table (
  id             uuid,
  user_id        uuid,
  task_id        uuid,
  task_text      text,
  due            date,
  due_time       time,
  timezone       text,
  offset_minutes int
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.user_id, t.id, t.text, t.due, t.due_time, us.timezone, r.offset_minutes
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
     and t.due is not null
     and t.due_time is not null
     and (
       -- recurring: fixed-cadence, fires regardless of done-today
       t.recurring is not null
       -- one-off: not already done today
       or coalesce((ds.done ->> t.id::text)::boolean, false) = false
     )
   order by r.fire_at;
$$;

-- ============================================================================
-- claim_task_reminder — the exactly-once send lock; recurring rows self-advance
-- ============================================================================
-- One-off (task.recurring IS NULL): the UPDATE of sent_at is the lock (an overlapping run gets null
-- and skips). Recurring: ADVANCE fire_at to the next occurrence − offset — `fire_at <= now()` in
-- the WHERE is the lock (the loser re-reads the advanced future fire_at and skips). sent_at stays
-- null → the series is re-armed.
create or replace function public.claim_task_reminder(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id        uuid;
  v_recurring boolean;
  v_due       date;
  v_due_time  time;
  v_offset    int;
  v_freq      int;
  v_tz        text;
begin
  select t.recurring is not null, t.due, t.due_time, r.offset_minutes,
         (t.recurring ->> 'frequencyDays')::int, us.timezone
    into v_recurring, v_due, v_due_time, v_offset, v_freq, v_tz
    from public.task_reminders r
    join public.tasks t on t.id = r.task_id
    join public.user_schedule us on us.user_id = r.user_id
   where r.id = p_id;

  if v_recurring then
    update public.task_reminders
       set fire_at = public.next_recurring_fire_at(v_due, v_due_time, v_freq, v_offset, v_tz)
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
-- ADVANCE to the next occurrence − offset instead. Kind is task.recurring (join required now that
-- the row no longer flags itself). Returns the total touched (logged by the dispatcher).
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
    update public.task_reminders r
       set sent_at = now()
      from public.tasks t
     where r.sent_at is null
       and r.fire_at <= now() - interval '60 minutes'
       and t.id = r.task_id
       and t.recurring is null
     returning 1
  ),
  advanced as (
    update public.task_reminders r
       set fire_at = public.next_recurring_fire_at(
                       t.due, t.due_time,
                       (t.recurring ->> 'frequencyDays')::int, r.offset_minutes, us.timezone)
      from public.tasks t, public.user_schedule us
     where r.sent_at is null
       and r.fire_at <= now() - interval '60 minutes'
       and t.id = r.task_id
       and us.user_id = r.user_id
       and t.recurring is not null
     returning 1
  )
  select (select count(*) from retired) + (select count(*) from advanced) into v_count;
  return v_count;
end;
$$;

-- ============================================================================
-- Triggers — fire_at can never go stale (kind-aware via task.recurring)
-- ============================================================================
-- Due/due_time edit: clearing either deletes ALL of the task's reminders (both kinds anchor on
-- them now); otherwise recompute + re-arm using the kind's formula.
create or replace function public.task_reminders_recompute_fn()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tz   text;
  v_freq int;
begin
  if new.due is null or new.due_time is null then
    delete from public.task_reminders where task_id = new.id;
    return new;
  end if;

  select timezone into v_tz from public.user_schedule where user_id = new.user_id;
  v_tz := coalesce(v_tz, 'UTC');

  if new.recurring is not null then
    v_freq := (new.recurring ->> 'frequencyDays')::int;
    update public.task_reminders
       set fire_at = public.next_recurring_fire_at(new.due, new.due_time, v_freq,
                                                   offset_minutes, v_tz),
           sent_at = null
     where task_id = new.id;
  else
    update public.task_reminders
       set fire_at = public.reminder_fire_at(new.due, new.due_time, v_tz, offset_minutes),
           sent_at = null
     where task_id = new.id;
  end if;

  return new;
end;
$$;

-- Timezone change: recompute PENDING fire times for BOTH kinds (same wall-clock deadline, new
-- clock). One-off rows re-project through reminder_fire_at; recurring rows re-project the next
-- occurrence − offset on the anchor cadence in the new zone.
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
     and t.recurring is null
     and t.due is not null
     and t.due_time is not null;

  update public.task_reminders r
     set fire_at = public.next_recurring_fire_at(
                     t.due, t.due_time,
                     (t.recurring ->> 'frequencyDays')::int, r.offset_minutes, new.timezone)
    from public.tasks t
   where r.task_id = t.id
     and r.user_id = new.user_id
     and r.sent_at is null
     and t.recurring is not null
     and t.due is not null
     and t.due_time is not null;

  return new;
end;
$$;

-- Recurring change: keep a recurring task's reminders anchored to the right formula, but NEVER
-- re-arm on a plain completion (fire_at is due-anchored, independent of lastDoneAt). No anchor
-- (no due/due_time) → nothing can exist, no-op. Cleared recurring → the reminders become one-off
-- (fire once). Became recurring, or the cadence changed → re-anchor to the occurrence grid. Only
-- lastDoneAt/doneCount/ongoing/targetEnd changed → no-op (the crux of the fixed-cadence rule).
create or replace function public.task_reminders_recurring_change_fn()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tz   text;
  v_freq int;
begin
  if new.due is null or new.due_time is null then
    return new;
  end if;

  select timezone into v_tz from public.user_schedule where user_id = new.user_id;
  v_tz := coalesce(v_tz, 'UTC');

  if new.recurring is null then
    update public.task_reminders
       set fire_at = public.reminder_fire_at(new.due, new.due_time, v_tz, offset_minutes),
           sent_at = null
     where task_id = new.id;
  elsif old.recurring is null
        or (old.recurring ->> 'frequencyDays') is distinct from (new.recurring ->> 'frequencyDays')
  then
    v_freq := (new.recurring ->> 'frequencyDays')::int;
    update public.task_reminders
       set fire_at = public.next_recurring_fire_at(new.due, new.due_time, v_freq,
                                                   offset_minutes, v_tz),
           sent_at = null
     where task_id = new.id;
  end if;

  return new;
end;
$$;

-- The trigger itself is unchanged from #231 (after update of recurring, when it actually changed);
-- only its function body above is redefined.

-- ============================================================================
-- set_task_reminder — now ADDS/re-arms an offset on a RECURRING task too (was: refused it)
-- ============================================================================
-- Behaviour identical to 20260711000000 EXCEPT recurring is now allowed: for a recurring task the
-- fire time is the next occurrence − offset (next_recurring_fire_at); for a one-off it is
-- due − offset (reminder_fire_at). Same range check, same not-found / missing-due-time raises, same
-- ON CONFLICT (task_id, offset_minutes) upsert, same returned fire_at (callers can still flag an
-- already-past lead time — for a recurring task the RPC returns the next FUTURE slot instead).
create or replace function public.set_task_reminder(p_task_id uuid, p_offset_minutes int)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_due       date;
  v_due_time  time;
  v_recurring jsonb;
  v_freq      int;
  v_tz        text;
  v_fire      timestamptz;
begin
  if p_offset_minutes is null or p_offset_minutes < 0 or p_offset_minutes > 40320 then
    raise exception 'offset_out_of_range' using errcode = 'P0001';
  end if;

  -- RLS scopes this select to the caller's own live tasks; not-found ⇒ missing or not theirs.
  select due, due_time, recurring into v_due, v_due_time, v_recurring
    from public.tasks
    where id = p_task_id and deleted_at is null;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;
  if v_due is null or v_due_time is null then
    raise exception 'task_missing_due_time' using errcode = 'P0001';
  end if;

  select timezone into v_tz from public.user_schedule where user_id = auth.uid();
  v_tz := coalesce(v_tz, 'UTC');

  if v_recurring is not null then
    v_freq := (v_recurring ->> 'frequencyDays')::int;
    v_fire := public.next_recurring_fire_at(v_due, v_due_time, v_freq, p_offset_minutes, v_tz);
  else
    v_fire := public.reminder_fire_at(v_due, v_due_time, v_tz, p_offset_minutes);
  end if;

  -- user_id omitted → column default auth.uid() + RLS WITH CHECK assign/enforce ownership.
  insert into public.task_reminders (task_id, offset_minutes, fire_at, sent_at)
  values (p_task_id, p_offset_minutes, v_fire, null)
  on conflict (task_id, offset_minutes) do update
    set fire_at = excluded.fire_at,
        sent_at = null;

  return v_fire;
end;
$$;

-- ============================================================================
-- Drop the #231 time-of-day write path (superseded by the offset RPCs)
-- ============================================================================
drop function if exists public.set_recurring_reminder(uuid, time);
drop function if exists public.remove_recurring_reminder(uuid);

-- ============================================================================
-- Schema: retire the time_of_day kind — both kinds are offset rows now
-- ============================================================================
-- The ~1-day-old #231 alarms can't be re-anchored to a due date; clear them (users re-add).
delete from public.task_reminders where time_of_day is not null;

-- The XOR kind check and the one-recurring-per-task partial index both key on time_of_day — drop
-- them before the column. The #227 unique(task_id, offset_minutes) stays and now governs recurring
-- rows too (multiple offsets per task, one row per offset).
alter table public.task_reminders drop constraint if exists task_reminders_kind_ck;
drop index if exists public.task_reminders_recurring_key;
alter table public.task_reminders drop column time_of_day;

-- Every remaining row is an offset row (both kinds) → offset_minutes is required again.
alter table public.task_reminders alter column offset_minutes set not null;

comment on table public.task_reminders is
  'Per-task push reminders (ADR 2026-07-09; multi-reminder 2026-07-11; recurring unified 2026-07-12). '
  'Every row carries offset_minutes; the KIND is the task''s: a ONE-OFF task fires fire_at = '
  '(due + due_time in tz) − offset once (locked by sent_at); a RECURRING task fires the next cadence '
  'occurrence (anchored to due + due_time) − offset, and claim ADVANCES fire_at each cycle (sent_at '
  'stays null) so the fixed-cadence series re-arms. unique(task_id, offset_minutes) allows several '
  'lead times per task.';

-- ============================================================================
-- Grants (re-issue the DEFINER sweep fns for service_role; set_task_reminder for authenticated)
-- ============================================================================
revoke all on function public.due_task_reminders() from public;
grant execute on function public.due_task_reminders() to service_role;
revoke all on function public.claim_task_reminder(uuid) from public;
grant execute on function public.claim_task_reminder(uuid) to service_role;
revoke all on function public.expire_stale_reminders() from public;
grant execute on function public.expire_stale_reminders() to service_role;

grant execute on function public.set_task_reminder(uuid, int) to authenticated;
