-- Intent: give tasks an optional START DATE (tasks.start_date) — a task with a future start date
-- is DORMANT: hidden from the grid/list/mobile surfaces, excluded from Plan My Day and the morning
-- push, and its reminders are suppressed, until the user's local calendar reaches that date. It
-- then wakes by itself (dormancy is computed against "today in the user's timezone" at read time —
-- no cron, no state transition) and reappears at its stored x/y. One column serves both faces of
-- the feature: "start this task on Aug 1" at creation, and "pause this project until Aug 1" on an
-- existing task (the UI's Pause = setting a future start date; Resume = clearing it).
--
-- Like `due`, start_date is a floating wall-clock DATE (ADR 2026-07-08-due-dates-wall-clock),
-- interpreted in user_schedule.timezone — never an instant. "Dormant" everywhere means
-- start_date > today-in-the-user's-zone; the client twin of that predicate is isDormant()
-- (src/lib/start-date.ts), the edge twin lives in _shared (plan-inputs / chat-context).
--
-- Three SQL readers gain the dormancy gate here (the client/edge readers change in code):
--   * due_task_reminders   the minute sweep would otherwise still push a paused task's reminder.
--   * dispatch_inputs_for_user   the morning proactive push would otherwise plan/count a paused task.
--   * restore_backup   re-created to round-trip start_date. The body is VERBATIM from
--     20260717000000_restore_backup_completed_ongoing.sql (#299 — completed_at/ongoing round-trip
--     + legacy-snapshot ongoing promotion) with only start_date added to the insert list, the
--     select, and the on-conflict update — keep it that way in any future re-create.

alter table public.tasks
  add column start_date date;

comment on column public.tasks.start_date is
  'Optional wall-clock start date (user timezone, like due). While start_date > the user''s local today the task is DORMANT: hidden from every surface, excluded from plans/dispatch, reminders suppressed. NULL = live now. Pausing a task = setting a future start_date.';

-- ============================================================================
-- due_task_reminders — unchanged except the task join now skips DORMANT tasks
-- ============================================================================
-- A paused task's reminders must not fire mid-pause. The row is left untouched (sent_at stays
-- null): a one-off whose fire time elapses during the pause is retired by expire_stale_reminders
-- (firing late on wake would be noise), and a recurring row self-advances there to its next
-- occurrence, so the series resumes cleanly after the start date. Body otherwise verbatim from
-- 20260712000000_recurring_reminders_unify.sql.
create or replace function public.due_task_reminders()
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
     -- dormant (future start date, user's local day) ⇒ no push
     and (t.start_date is null or t.start_date <= (now() at time zone us.timezone)::date)
     and (
       -- recurring: fixed-cadence, fires regardless of done-today
       t.recurring is not null
       -- one-off: not already done today
       or coalesce((ds.done ->> t.id::text)::boolean, false) = false
     )
   order by r.fire_at;
$$;

-- ============================================================================
-- dispatch_inputs_for_user — unchanged except the task select now skips DORMANT tasks
-- ============================================================================
-- Same single-choke-point pattern as the completed_at gate (20260709130000): every downstream
-- consumer (buildMorningFromPlan / buildMorningMessage / buildRecapMessage / buildPlanRequest)
-- inherits it, so a paused task can't reach the morning plan, the ⏰ TODAY list, or board counts.
-- p_local_date is already the user's local date (the dispatcher computes it per user).
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
             'due', t.due, 'due_time', t.due_time, 'staged', t.staged,
             'recurring', t.recurring, 'size', t.size
           )),
           '[]'::jsonb
         )
    into v_tasks
    from public.tasks t
    where t.user_id = p_user_id
      and t.deleted_at is null
      and t.completed_at is null   -- exclude permanently completed one-off tasks (survives daily reset)
      and (t.start_date is null or t.start_date <= p_local_date);  -- exclude dormant (paused) tasks

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

-- Fence: service_role ONLY (restated so this file stands alone, matching 20260709130000).
revoke all on function public.dispatch_inputs_for_user(uuid, date) from public;
grant execute on function public.dispatch_inputs_for_user(uuid, date) to service_role;

-- ============================================================================
-- restore_backup — verbatim 20260717000000 (#299) + start_date round-trip
-- ============================================================================
-- #299's body (completed_at/ongoing round-trip + legacy-snapshot ongoing promotion) with
-- start_date added to the insert list, the select, and the on-conflict update — nothing else
-- touched, so #299's legacy handling survives this re-create. A snapshot without the key yields
-- NULL (the task restores live-now), the right reading of a pre-feature snapshot. create_backup
-- snapshots via to_jsonb(t), so the snapshot side needs no change.
create or replace function public.restore_backup(p_backup_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_data jsonb;
begin
  select data into v_data
  from public.backups
  where id = p_backup_id and user_id = auth.uid();

  if v_data is null then
    raise exception 'restore_backup: backup % not found', p_backup_id;
  end if;

  -- --- tasks ---------------------------------------------------------------
  -- l.legacy_ongoing: this element comes from a pre-20260713000000 snapshot (no 'ongoing' key —
  -- post-migration snapshots always carry one, the column is NOT NULL) AND was an ongoing
  -- project under the old encoding (recurring.ongoing = true).
  insert into public.tasks
    (id, user_id, text, x, y, due, due_time, size, staged, bucket, recurring,
     completed_at, ongoing, start_date, created_at, deleted_at)
  select
    (e->>'id')::uuid,
    auth.uid(),
    e->>'text',
    (e->>'x')::double precision,
    (e->>'y')::double precision,
    -- Legacy ongoing rows: promote the old soft targetEnd to the due date when the task has
    -- none — the same coalesce 20260713000000 applied to live rows. ->> yields text and due is
    -- a date, so both arms cast; nullif guards a stored '' so ''::date can't error.
    case when l.legacy_ongoing
         then coalesce(left(e->>'due', 10)::date, nullif(e->'recurring'->>'targetEnd', '')::date)
         else left(e->>'due', 10)::date
    end,
    (e->>'due_time')::time,
    e->>'size',
    (e->>'staged')::boolean,
    e->>'bucket',
    -- Legacy ongoing rows shed their recurring jsonb (the dropped cadence/doneCount were
    -- discarded by 20260713000000 too); everything else passes through verbatim.
    case when l.legacy_ongoing then null
         else nullif(e->'recurring', 'null'::jsonb)
    end,
    (e->>'completed_at')::timestamptz,
    -- Snapshot value when present; legacy fallback otherwise. The coalesce also satisfies the
    -- column's NOT NULL for legacy elements (absent key ->> null).
    coalesce((e->>'ongoing')::boolean, l.legacy_ongoing),
    left(e->>'start_date', 10)::date,
    (e->>'created_at')::timestamptz,
    null
  from jsonb_array_elements(v_data->'tasks') as e
  cross join lateral (
    select ((e->>'ongoing') is null)
       and coalesce(e->'recurring'->>'ongoing' = 'true', false) as legacy_ongoing
  ) as l
  on conflict (id) do update set
    text         = excluded.text,
    x            = excluded.x,
    y            = excluded.y,
    due          = excluded.due,
    due_time     = excluded.due_time,
    size         = excluded.size,
    staged       = excluded.staged,
    bucket       = excluded.bucket,
    recurring    = excluded.recurring,
    completed_at = excluded.completed_at,
    ongoing      = excluded.ongoing,
    start_date   = excluded.start_date,
    deleted_at   = null;

  update public.tasks
  set deleted_at = now()
  where user_id = auth.uid()
    and deleted_at is null
    and id not in (
      select (e->>'id')::uuid from jsonb_array_elements(v_data->'tasks') as e
    );

  -- --- habits --------------------------------------------------------------
  insert into public.habits
    (id, user_id, text, active, subtasks, created_at, deleted_at)
  select
    (e->>'id')::uuid,
    auth.uid(),
    e->>'text',
    (e->>'active')::boolean,
    coalesce(e->'subtasks', '[]'::jsonb),
    (e->>'created_at')::timestamptz,
    null
  from jsonb_array_elements(v_data->'habits') as e
  on conflict (id) do update set
    text       = excluded.text,
    active     = excluded.active,
    subtasks   = excluded.subtasks,
    deleted_at = null;

  update public.habits
  set deleted_at = now()
  where user_id = auth.uid()
    and deleted_at is null
    and id not in (
      select (e->>'id')::uuid from jsonb_array_elements(v_data->'habits') as e
    );

  -- --- schedule ------------------------------------------------------------
  -- Upsert (not a bare UPDATE): the user_schedule row is seeded app-side on first load, not by a
  -- trigger, so an UPDATE-only would silently drop the snapshot's schedule if the row were absent.
  if v_data ? 'schedule' and v_data->'schedule' <> 'null'::jsonb then
    insert into public.user_schedule (user_id, timezone, config)
    values (
      auth.uid(),
      coalesce(v_data->'schedule'->>'timezone', 'UTC'),
      coalesce(v_data->'schedule'->'config', '{}'::jsonb)
    )
    on conflict (user_id) do update set
      timezone = coalesce(v_data->'schedule'->>'timezone', public.user_schedule.timezone),
      config   = coalesce(v_data->'schedule'->'config', public.user_schedule.config);
  end if;
end;
$$;

-- Down path (manual reversal):
--   alter table public.tasks drop column start_date;
--   -- re-create due_task_reminders from 20260712000000_recurring_reminders_unify.sql
--   -- re-create dispatch_inputs_for_user from 20260709130000_dispatch_exclude_completed_tasks.sql
--   -- re-create restore_backup from 20260717000000_restore_backup_completed_ongoing.sql
