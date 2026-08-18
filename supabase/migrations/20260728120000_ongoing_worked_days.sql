-- Migration: ongoing_worked_days
--
-- Intent: an ONGOING project is a standing effort you CHIP AWAY at — but until now the app had no
-- way to say "I put time into this today". The ✓ on an ongoing project ran the one-off archive path
-- (set_task_done → completed_at + a history row), so the only expressible states were "untouched"
-- and "over". There was no third state, and therefore nothing for Plan My Day or BabyClaw to pace
-- against: the planner re-suggested a project the morning after a long session because it could not
-- tell the session had happened.
--
-- So an ongoing project gets a SESSION LOG: `tasks.worked_days`, the local calendar days the user
-- logged work, newest first, capped at 14 entries. From it we derive last-worked, the consecutive
-- run, and "worked today" — everything the pacing rules and the UI counter need.
--
-- Why date[] and not a timestamptz scalar or a child table:
--   * a scalar `last_worked_on` cannot answer "how many days running", which is the whole point of
--     "not several days in a row except occasionally". Storing a `streak` int alongside it is
--     derived state with a desync class, and undo becomes lossy (undoing a streak-1 session forgets
--     the project was also worked five days earlier).
--   * a child table buys a heatmap nobody asked for, at the cost of a table + a per-user cap trigger
--     + a backup round-trip + a second query on five separate readers.
--   * one small array answers every question exactly, undoes exactly, and rides create_backup's
--     to_jsonb(t) for free.
--
-- DATE not timestamptz: every consumer (React, Deno, SQL) needs the user's local CALENDAR day, the
-- same floating wall-clock model as `due` and `start_date` (ADR 2026-07-08-due-dates-wall-clock).
-- Dates also compare correctly as plain strings in all three runtimes.
--
-- Deliberately NOT added: `check (worked_days is null or ongoing)`. Switching an ongoing project to
-- a recurring chore sets ongoing = false in one statement, and such a CHECK would reject it unless
-- the writer also nulled the log — the same trap tasks_type_exclusive_ck already sets. Leaving the
-- array in place means switching back restores the history, which is the nicer behavior anyway; the
-- derive helpers return null for any non-ongoing task, so nothing renders.
--
-- Also fixes a LIVE BUG, unrelated to the session log but in the same function: since ongoing became
-- its own column (20260713000000), dispatch_inputs_for_user has never selected it. plan-inputs.ts
-- computes `ongoing: t.ongoing ?? false`, so on the PROACTIVE/push path every task arrived as
-- not-ongoing and the plan prompt's entire ONGOING PROJECTS section was dead code. Same class as the
-- task-sizing miss (#193): a plan-feeding field must reach all three readers.
--
-- Down path (manual reversal):
--   drop function if exists public.log_task_work(uuid, date, boolean);
--   alter table public.tasks drop constraint tasks_worked_days_len;
--   alter table public.tasks drop column worked_days;
--   -- then re-create log_task_activity + restore_backup from 20260721120000_task_activity.sql
--   -- and dispatch_inputs_for_user from 20260722190000_dispatch_waking_tasks.sql.

-- ============================================================================
-- (a) the column
-- ============================================================================

alter table public.tasks
  add column worked_days date[];

comment on column public.tasks.worked_days is
  'ONGOING projects only: local wall-clock days (user_schedule.timezone) the user logged a work '
  'session, NEWEST FIRST, at most 14. Entry [1] is the last-worked day. NULL/absent = no sessions '
  'logged. Written only by log_task_work(); the length CHECK is the backstop because authenticated '
  'holds table-level UPDATE on tasks. Unlike completed_at this never archives the task — a session '
  'is progress, not completion.';

-- Volume backstop, NOT just a display bound: `authenticated` holds a table-level UPDATE grant on
-- tasks (useUpdateTask writes columns directly), so an invariant enforced only inside the RPC would
-- be bypassable — exactly the "an invariant enforced only inside an RPC is bypassable" rule. 14
-- dates is ~140 bytes and covers the longest run any pacing rule reasons about.
-- array_length('{}', 1) is NULL, which passes the CHECK; so does a NULL column.
alter table public.tasks
  add constraint tasks_worked_days_len
  check (worked_days is null or array_length(worked_days, 1) <= 14);

-- ============================================================================
-- (b) log_task_work — the only write path for the session log
-- ============================================================================
--
-- SECURITY INVOKER, deliberately: RLS on public.tasks (tasks_update_own) already fences this to the
-- caller's own rows, so it needs no DEFINER privileges and never appears in the DEFINER-scope guard's
-- classification list. The `and t.user_id = auth.uid()` predicates are belt-and-braces on top of RLS.
--
-- Idempotent by set semantics: logging the same day twice is a no-op, so a double-tap can neither
-- inflate the run length nor duplicate an entry.
create or replace function public.log_task_work(
  p_task_id    uuid,
  p_local_date date,
  p_logged     boolean default true
)
returns date[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_days date[];
  v_cap  constant int := 14;
begin
  -- Clock sanity. The client supplies its own LOCAL calendar day, which legitimately sits up to a
  -- day either side of server UTC (the user's zone may be ahead or behind). Anything beyond that is
  -- a wrong device clock or an attempt to backfill history, either of which would poison the
  -- recency math the planner reads. Same spirit as daily_state's date-window guard.
  if p_local_date > current_date + 2 or p_local_date < current_date - 2 then
    raise exception 'work_date_out_of_range' using errcode = 'P0001';
  end if;

  -- Read-modify-write under a row lock so two concurrent logs (phone + laptop) can't lose one
  -- another's entry. FOR UPDATE is evaluated after RLS, so this can only ever lock the owner's row.
  select t.worked_days into v_days
    from public.tasks t
   where t.id = p_task_id
     and t.user_id = auth.uid()
     and t.ongoing                 -- the session log is meaningless on a chore or a one-off
     and t.deleted_at is null
     and t.completed_at is null
   for update;

  if not found then
    return null;                   -- not yours / not ongoing / trashed / already finished
  end if;

  if p_logged then
    -- distinct + newest-first + capped, in one pass.
    select array_agg(d order by d desc)
      into v_days
      from (
        select distinct d
          from unnest(array_prepend(p_local_date, coalesce(v_days, '{}'::date[]))) as d
         order by d desc
         limit v_cap
      ) s(d);
  else
    -- Undo today's session. An emptied array collapses to NULL so "no sessions" has ONE encoding.
    v_days := nullif(
      array_remove(coalesce(v_days, '{}'::date[]), p_local_date),
      '{}'::date[]
    );
  end if;

  update public.tasks
     set worked_days = v_days
   where id = p_task_id
     and user_id = auth.uid();

  return v_days;
end;
$$;

revoke all on function public.log_task_work(uuid, date, boolean) from public;
grant execute on function public.log_task_work(uuid, date, boolean) to authenticated;

comment on function public.log_task_work(uuid, date, boolean) is
  'Log (or un-log) a work session on an ONGOING project for one local calendar day. Returns the new '
  'worked_days array. INVOKER: fenced by RLS on tasks. Idempotent per day.';

-- ============================================================================
-- (c) log_task_activity — re-created VERBATIM from 20260721120000_task_activity.sql,
--     plus ONE new branch: a logged work session.
-- ============================================================================
--
-- Without this branch a worked_days-only UPDATE falls through every elsif to `else return null`, so
-- sessions would be invisible to the recap — the one activity that most deserves a mention. Only an
-- ADDED session logs; undoing one falls through and logs nothing, matching how the other
-- toggle-style edits behave.
--
-- v_keep = 500 and the todoclaw.suppress_activity GUC and the placed/moved 10s de-noise window are
-- all carried forward unchanged (task-activity-retention.test.ts pins them).
create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind   text;
  v_detail jsonb := '{}'::jsonb;
  v_oldq   text;
  v_newq   text;
  v_had_placed boolean;
  v_keep   constant int := 500;
begin
  -- restore_backup sets this txn-local GUC so its bulk upsert/soft-delete doesn't flood the log.
  if coalesce(current_setting('todoclaw.suppress_activity', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_kind := 'created';
    v_detail := jsonb_build_object(
      'staged',         new.staged,
      'quadrant',       public.task_quadrant(new.x, new.y),
      'due',            new.due,
      'due_time',       new.due_time,
      'recurring_days', (new.recurring->>'frequencyDays')::int,
      'ongoing',        new.ongoing,
      'start_date',     new.start_date);
  else
    v_oldq := public.task_quadrant(old.x, old.y);
    v_newq := public.task_quadrant(new.x, new.y);

    -- (1) terminal state: delete / restore-from-trash / complete / uncomplete, then recurring
    --     completion (a recurring chore never touches completed_at — it advances lastDoneAt).
    if    old.deleted_at is null     and new.deleted_at is not null then
      v_kind := 'deleted';
    elsif old.deleted_at is not null and new.deleted_at is null     then
      v_kind := 'restored_from_trash';
    elsif old.completed_at is null   and new.completed_at is not null then
      v_kind := 'completed';
      v_detail := jsonb_build_object('type', case when new.ongoing then 'ongoing' else 'oneoff' end);
    elsif old.completed_at is not null and new.completed_at is null then
      v_kind := 'uncompleted';
    elsif new.recurring is not null and old.recurring is not null
          and (new.recurring->>'frequencyDays') is not distinct from (old.recurring->>'frequencyDays')
          and (new.recurring->>'lastDoneAt') is distinct from (old.recurring->>'lastDoneAt')
          and (new.recurring->>'lastDoneAt') is not null then
      v_kind := 'completed';
      v_detail := jsonb_build_object('type', 'recurring');

    -- (1b) NEW: a work session logged on an ongoing project. Progress, never completion — so it
    --      sits with the terminal-state family but can never be mistaken for one. Only a GROWN log
    --      counts; an undo shrinks it and falls through to `else return null`.
    elsif coalesce(array_length(new.worked_days, 1), 0)
          > coalesce(array_length(old.worked_days, 1), 0) then
      v_kind := 'worked';
      v_detail := jsonb_build_object('sessions', coalesce(array_length(new.worked_days, 1), 0));

    -- (2) type changes — the flag that went POSITIVE wins (make_ongoing also nulls recurring,
    --     so it must be tested before the "recurring cleared" branch).
    elsif old.ongoing = false and new.ongoing = true then
      v_kind := 'made_ongoing';
    elsif old.recurring is null and new.recurring is not null then
      v_kind := 'made_recurring';
      v_detail := jsonb_build_object('frequency_days', (new.recurring->>'frequencyDays')::int);
    elsif old.recurring is not null and new.recurring is not null
          and (old.recurring->>'frequencyDays') is distinct from (new.recurring->>'frequencyDays') then
      v_kind := 'recurring_retuned';
      v_detail := jsonb_build_object(
        'frequency_days', (new.recurring->>'frequencyDays')::int,
        'from_days',      (old.recurring->>'frequencyDays')::int);
    elsif (old.recurring is not null or old.ongoing = true)
          and new.recurring is null and new.ongoing = false then
      v_kind := 'type_cleared';
      v_detail := jsonb_build_object('was', case when old.ongoing then 'ongoing' else 'recurring' end);

    -- (3) due date / time
    elsif old.due is distinct from new.due or old.due_time is distinct from new.due_time then
      if new.due is null then
        v_kind := 'due_cleared';
      else
        v_kind := 'due_set';
        v_detail := jsonb_build_object('due', new.due, 'due_time', new.due_time);
      end if;

    -- (4) pause / resume (start_date)
    elsif old.start_date is distinct from new.start_date then
      if new.start_date is not null then
        v_kind := 'paused';
        v_detail := jsonb_build_object('until', new.start_date);
      else
        v_kind := 'resumed';
      end if;

    -- (5) rename
    elsif old.text is distinct from new.text then
      v_kind := 'renamed';
      v_detail := jsonb_build_object('from', left(old.text, 200));

    -- (6) staged -> placed on the grid
    elsif old.staged = true and new.staged = false then
      v_kind := 'placed';
      v_detail := jsonb_build_object('quadrant', v_newq);

    -- (7) reprioritize: an already-placed card that crosses into a DIFFERENT quadrant. Tiny
    --     intra-quadrant drag nudges (same quadrant) log nothing — the "meaningful moves only" rule.
    elsif old.staged = false and new.staged = false
          and v_oldq is not null and v_newq is not null and v_oldq <> v_newq then
      v_kind := 'moved';
      v_detail := jsonb_build_object('from_quadrant', v_oldq, 'to_quadrant', v_newq);
    else
      return null;                       -- nothing meaningful changed
    end if;
  end if;

  -- Grid double-write de-noise: a placement fires a mid-drag {staged:false} then a final {x,y}
  -- ms apart → placed(q1) + moved(q1→q2). Collapse the positioning family within a short window to
  -- ONE row: if a recent 'placed' exists, this is that placement being finalized (keep 'placed',
  -- final quadrant); otherwise a deliberate later re-drag stands as its own 'moved'.
  if v_kind in ('placed', 'moved') then
    select exists(
      select 1 from public.task_activity
      where task_id = new.id and kind = 'placed'
        and created_at > now() - interval '10 seconds'
    ) into v_had_placed;
    delete from public.task_activity
      where task_id = new.id and kind in ('placed', 'moved')
        and created_at > now() - interval '10 seconds';
    if v_had_placed then
      v_kind := 'placed';
      v_detail := jsonb_build_object('quadrant', v_newq);
    end if;
  end if;

  insert into public.task_activity (user_id, task_id, kind, task_text, detail)
  values (new.user_id, new.id, v_kind, new.text, v_detail);

  -- Retention: keep newest-N per user via DELETE-not-in-newest-N (create_backup precedent).
  -- NEVER a raise-on-cap (assistant_memories_cap style) — that would abort the user's task write.
  delete from public.task_activity
   where user_id = new.user_id
     and id not in (
       select id from public.task_activity
       where user_id = new.user_id
       order by created_at desc
       limit v_keep
     );

  return null;                           -- AFTER trigger; return value ignored
end;
$$;

revoke all on function public.log_task_activity() from public;

-- ============================================================================
-- (d) restore_backup — re-created VERBATIM from 20260721120000_task_activity.sql,
--     plus the worked_days round-trip.
-- ============================================================================
--
-- create_backup snapshots whole rows via to_jsonb(t), so a post-migration snapshot already CARRIES
-- worked_days (as a JSON array of 'YYYY-MM-DD' strings) — but restore's explicit column list would
-- silently drop it, degrading a restored project's session log to empty. Legacy snapshots have no
-- 'worked_days' key at all; jsonb_typeof(NULL) is NULL, so those restore as NULL, which is exactly
-- "no sessions logged".
create or replace function public.restore_backup(p_backup_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_data jsonb;
begin
  -- Suppress activity logging for this restore's bulk task writes (txn-local; auto-resets at commit).
  perform set_config('todoclaw.suppress_activity', 'on', true);

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
     completed_at, ongoing, start_date, worked_days, created_at, deleted_at)
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
    -- Session log. WITH ORDINALITY + explicit order preserves the stored newest-first order rather
    -- than trusting document order. The stored array is already capped and de-duplicated, and the
    -- length CHECK re-verifies it on the way in.
    case when jsonb_typeof(e->'worked_days') = 'array'
         then (select array_agg(a.v::date order by a.ord)
                 from jsonb_array_elements_text(e->'worked_days')
                      with ordinality as a(v, ord))
         else null
    end,
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
    worked_days  = excluded.worked_days,
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

-- ============================================================================
-- (e) dispatch_inputs_for_user — re-created VERBATIM from
--     20260722190000_dispatch_waking_tasks.sql, plus `ongoing` (the live bug) and `worked_days`.
-- ============================================================================
--
-- `ongoing` has been missing from this payload since the flag was created, silently disabling the
-- plan prompt's ONGOING PROJECTS guidance on the proactive/push path. `worked_days` rides along so
-- the same path can pace sessions. Every prior behavior is preserved: the completed_at + dormancy
-- exclusions, the waking look-ahead, the config/habits/daily_state reads, and the service_role-only
-- fence. Kept security-definer / service-role exactly as before.
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
  v_waking     jsonb;
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = 'P0001';
  end if;

  select config into v_config from public.user_schedule where user_id = p_user_id;

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'id', t.id, 'text', t.text, 'x', t.x, 'y', t.y,
             'due', t.due, 'due_time', t.due_time, 'staged', t.staged,
             'recurring', t.recurring, 'size', t.size,
             'ongoing', t.ongoing, 'worked_days', to_jsonb(t.worked_days)
           )),
           '[]'::jsonb
         )
    into v_tasks
    from public.tasks t
    where t.user_id = p_user_id
      and t.deleted_at is null
      and t.completed_at is null   -- exclude permanently completed one-off tasks (survives daily reset)
      and (t.start_date is null or t.start_date <= p_local_date);  -- exclude dormant (paused) tasks

  -- Dormant tasks un-pausing within the look-ahead window (start_date strictly future, <= +3 days).
  -- These are heads-up material for the recap ONLY — deliberately NOT added to v_tasks above, so a
  -- paused task never re-enters the plan/board. Newest-first is meaningless here; order by soonest.
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'id', t.id, 'text', t.text, 'start_date', t.start_date, 'due', t.due
           ) order by t.start_date),
           '[]'::jsonb
         )
    into v_waking
    from public.tasks t
    where t.user_id = p_user_id
      and t.deleted_at is null
      and t.completed_at is null
      and t.start_date is not null
      and t.start_date > p_local_date
      and t.start_date <= p_local_date + 3;

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
    'plan', v_plan,
    'waking', v_waking
  );
end;
$$;

-- Fence: service_role ONLY (restated so this file stands alone, matching 20260722190000).
revoke all on function public.dispatch_inputs_for_user(uuid, date) from public;
grant execute on function public.dispatch_inputs_for_user(uuid, date) to service_role;
