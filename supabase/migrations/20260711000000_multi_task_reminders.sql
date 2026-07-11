-- Migration: multiple reminders per task (lifts the v1 one-per-task bound)
--
-- Intent: a task can now carry SEVERAL push reminders at different lead times — e.g. "1 day
-- before" AND "1 hour before". The pipeline from 20260709033335 already fans out per ROW: the
-- minute sweep (due_task_reminders), the exactly-once claim lock (claim_task_reminder), the
-- due/timezone recompute triggers, and the inbox insert all key on the reminder ROW, not the
-- task. So this migration only has to (a) relax the one-row-per-task uniqueness to one row per
-- (task, offset) and (b) retarget the write RPCs' conflict/delete to a specific offset. Nothing
-- about fire_at, freshness, dispatch, or the message copy changes — each reminder simply fires
-- on its own.
--
--   • task_reminders: drop unique(task_id) → add unique(task_id, offset_minutes). A task may hold
--     any number of distinct offsets; re-setting the same offset re-arms that one row.
--   • set_task_reminder(task_id, offset): now UPSERTS on (task_id, offset_minutes) — it ADDS (or
--     re-arms) one lead time instead of replacing the single reminder. Same validations, same
--     returned fire_at (so callers can still flag an already-past lead time).
--   • remove_task_reminder(task_id, offset): NEW — delete exactly one lead time (the picker's
--     chip-off). clear_task_reminder(task_id) is unchanged and still drops them ALL (the picker's
--     "Off" chip and the chat clear_reminder capability).
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.remove_task_reminder(uuid, int);
--   -- collapse any multi-reminder tasks to a single row before re-adding the strict unique, e.g.:
--   --   delete from public.task_reminders a using public.task_reminders b
--   --     where a.task_id = b.task_id and a.offset_minutes > b.offset_minutes;
--   alter table public.task_reminders drop constraint task_reminders_task_offset_key;
--   alter table public.task_reminders add constraint task_reminders_task_id_key unique (task_id);
--   -- re-create set_task_reminder from 20260709041944_reminder_rpcs_and_dispatch_duetime.sql
--   --   (on conflict (task_id)).
-- ----------------------------------------------------------------------------

-- ---- uniqueness: one row per (task, offset) --------------------------------------------------
alter table public.task_reminders drop constraint if exists task_reminders_task_id_key;
alter table public.task_reminders
  add constraint task_reminders_task_offset_key unique (task_id, offset_minutes);

comment on table public.task_reminders is
  'Per-task push reminders (ADR 2026-07-09; multi-reminder 2026-07-11): fire_at = (due + due_time '
  'in the user''s timezone) − offset_minutes, materialized on write and kept honest by the '
  'due/timezone triggers. A task may hold several rows at distinct offsets; each is swept, '
  'claimed, and sent independently. claim_task_reminder is the exactly-once send lock.';

-- ---- set_task_reminder: add/re-arm ONE offset (was: replace the single reminder) -------------
-- Behaviour identical to 20260709041944 EXCEPT the ON CONFLICT target is now (task_id,
-- offset_minutes): a fresh offset inserts a new row; an existing offset re-arms in place. The
-- validations (range, task exists + owned, has due date+time, not recurring) and the returned
-- fire_at are unchanged.
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
  if v_recurring is not null then
    raise exception 'task_recurring' using errcode = 'P0001';
  end if;

  select timezone into v_tz from public.user_schedule where user_id = auth.uid();
  v_fire := public.reminder_fire_at(v_due, v_due_time, v_tz, p_offset_minutes);

  -- user_id omitted → column default auth.uid() + RLS WITH CHECK assign/enforce ownership.
  insert into public.task_reminders (task_id, offset_minutes, fire_at, sent_at)
  values (p_task_id, p_offset_minutes, v_fire, null)
  on conflict (task_id, offset_minutes) do update
    set fire_at = excluded.fire_at,
        sent_at = null;

  return v_fire;
end;
$$;

-- ---- remove_task_reminder: delete ONE offset (the picker chip-off) ---------------------------
-- INVOKER + RLS: a signed-in user can only delete their own task's reminder row (no-op if none /
-- not theirs). clear_task_reminder(task_id) still removes every reminder for a task.
create or replace function public.remove_task_reminder(p_task_id uuid, p_offset_minutes int)
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.task_reminders
   where task_id = p_task_id and offset_minutes = p_offset_minutes;
$$;

grant execute on function public.set_task_reminder(uuid, int) to authenticated;
grant execute on function public.remove_task_reminder(uuid, int) to authenticated;
