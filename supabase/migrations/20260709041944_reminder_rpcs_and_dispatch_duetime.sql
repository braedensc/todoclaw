-- Migration: reminder write-RPCs + due_time in the dispatch bundle (reminders wave, PR 6)
--
-- Intent: let BabyClaw (the chat agent) set/clear a task reminder, and let the morning push list
-- what's due at what time — both reusing infrastructure from PR 4/5.
--
--   • reminder_fire_at(due, due_time, tz, offset) — the ONE canonical instant formula, factored
--     out of the PR-4 triggers (which inlined it twice). The triggers call it, the write-RPC uses
--     it, and the client reminder hook now routes its writes through set_task_reminder too (PR 6
--     review — it previously computed fire_at in TS, which disagreed with Postgres AT TIME ZONE by
--     an hour inside DST gap/ambiguous windows west of UTC). So this SQL expression is the SOLE
--     writer of fire_at — every path materializes the identical instant by construction.
--   • set_task_reminder / clear_task_reminder — SECURITY INVOKER (run as the caller under RLS,
--     auth.uid() intact), granted to authenticated. BabyClaw's set_reminder/clear_reminder
--     capabilities call these with the caller's JWT; a signed-in user can only touch their own
--     task + reminder (same RLS the client upsert already obeys). set_task_reminder RAISES if the
--     task has no due date+time (an alarm needs an instant) — the capability pre-checks for a
--     friendly message, this is the defense-in-depth backstop.
--   • dispatch_inputs_for_user — re-created to add 'due_time' to each task object (was absent), so
--     the dispatcher can surface today's due TIMES in the morning message. Body otherwise
--     identical to 20260708000000_dispatch_plan_content.sql.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.set_task_reminder(uuid, int);
--   drop function if exists public.clear_task_reminder(uuid);
--   -- re-create task_reminders_recompute_fn / task_reminders_tz_recompute_fn from
--   --   20260709033335_task_reminders_pipeline.sql (inline the fire_at expression again),
--   -- re-create dispatch_inputs_for_user from 20260708000000_dispatch_plan_content.sql (drop
--   --   'due_time'), then:
--   drop function if exists public.reminder_fire_at(date, time, text, int);
-- ----------------------------------------------------------------------------

-- ============================================================================
-- reminder_fire_at — the canonical instant: (due + due_time in tz) − offset minutes.
-- STABLE (not IMMUTABLE): `timestamp AT TIME ZONE <text zone>` resolves via the tz database, whose
-- rules can change with a tzdata update, so the result isn't immutable across the DB's lifetime —
-- only within a statement. STABLE + no table access is fully safe for the trigger/RPC call sites
-- here; it just must never be used in an index or generated-column expression (it isn't).
-- ============================================================================
create or replace function public.reminder_fire_at(
  p_due       date,
  p_due_time  time,
  p_tz        text,
  p_offset    int
)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select ((p_due::timestamp + p_due_time) at time zone coalesce(p_tz, 'UTC'))
         - make_interval(mins => p_offset);
$$;

-- ---- Re-create the PR-4 triggers to route through the helper (single source of truth) ----------

-- A due/due_time edit recomputes fire_at in the OWNER's timezone and RE-ARMS (sent_at := null);
-- clearing the date or the time deletes the reminder. (Behaviour identical to PR 4 — only the
-- inlined fire_at expression is replaced by reminder_fire_at().)
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
    delete from public.task_reminders where task_id = new.id;
    return new;
  end if;

  select timezone into v_tz from public.user_schedule where user_id = new.user_id;

  update public.task_reminders
     set fire_at = public.reminder_fire_at(new.due, new.due_time, v_tz, offset_minutes),
         sent_at = null
   where task_id = new.id;

  return new;
end;
$$;

-- A timezone change recomputes PENDING fire times only (same deadline, new clock).
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
     and t.due is not null
     and t.due_time is not null;
  return new;
end;
$$;

-- ============================================================================
-- set_task_reminder / clear_task_reminder — the signed-in write path (INVOKER, RLS-scoped).
-- ============================================================================

-- Upsert the caller's reminder for one of their own tasks, N minutes before its due instant, and
-- return the materialized fire_at (so a caller can tell the user if the lead time is already past).
-- Raises if the task is missing/not theirs, has no due date+time, or is recurring (the sweep never
-- fires reminders for recurring tasks — a reminder there would be silently dead). Re-arms
-- (sent_at := null) so re-setting an already-fired reminder fires again.
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
  on conflict (task_id) do update
    set offset_minutes = excluded.offset_minutes,
        fire_at        = excluded.fire_at,
        sent_at        = null;

  return v_fire;
end;
$$;

-- Delete the caller's reminder for one of their own tasks (no-op if none / not theirs — RLS).
create or replace function public.clear_task_reminder(p_task_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.task_reminders where task_id = p_task_id;
$$;

grant execute on function public.set_task_reminder(uuid, int) to authenticated;
grant execute on function public.clear_task_reminder(uuid) to authenticated;

-- ============================================================================
-- dispatch_inputs_for_user — add 'due_time' to each task object (else identical to
-- 20260708000000_dispatch_plan_content.sql). service_role grant carries over the replace.
-- ============================================================================
create or replace function public.dispatch_inputs_for_user(p_user_id uuid, p_local_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config     jsonb;
  v_tasks      jsonb;
  v_habits     jsonb;
  v_done       jsonb;
  v_habit_done jsonb;
  v_plan       jsonb;
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = 'P0001';
  end if;

  select config into v_config from public.user_schedule where user_id = p_user_id;

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'id', t.id, 'text', t.text, 'x', t.x, 'y', t.y,
             'due', t.due, 'due_time', t.due_time, 'staged', t.staged, 'recurring', t.recurring
           )),
           '[]'::jsonb
         )
    into v_tasks
    from public.tasks t
    where t.user_id = p_user_id and t.deleted_at is null;

  select coalesce(
           jsonb_agg(jsonb_build_object('id', h.id, 'text', h.text, 'active', h.active)),
           '[]'::jsonb
         )
    into v_habits
    from public.habits h
    where h.user_id = p_user_id and h.deleted_at is null;

  select done, habit_done, plan into v_done, v_habit_done, v_plan
    from public.daily_state
    where user_id = p_user_id and date = p_local_date;

  return jsonb_build_object(
    'config', coalesce(v_config, '{}'::jsonb),
    'tasks', v_tasks,
    'habits', v_habits,
    'done', coalesce(v_done, '{}'::jsonb),
    'habit_done', coalesce(v_habit_done, '{}'::jsonb),
    'plan', v_plan
  );
end;
$$;

revoke all on function public.dispatch_inputs_for_user(uuid, date) from public;
grant execute on function public.dispatch_inputs_for_user(uuid, date) to service_role;
