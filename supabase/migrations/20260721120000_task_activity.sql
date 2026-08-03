-- Migration: task_activity — an append-only log of what the user did to their tasks today.
--
-- Why: the app stores each task's CURRENT state, never what changed, so nothing can tell
-- "moved to ongoing today" from "always was ongoing." The evening check-in (and BabyClaw in
-- chat) want to recap the day's actions, so we record them.
--
-- The one chokepoint: there is NO create/update/delete RPC for tasks — the client
-- (use-tasks.ts .update(patch)) and BabyClaw (capabilities/tasks.ts updateTaskRow) both write
-- `tasks` directly with generic patches, and set_task_done/set_task_undone/restore_backup are
-- the only task-writing RPCs. So the single place every writer passes through is the table
-- itself: an AFTER INSERT OR UPDATE trigger that classifies the action by diffing OLD vs NEW.
-- Precedent: two AFTER UPDATE triggers already run on public.tasks (task_reminders recompute).
--
-- Security model (deliberately unlike those sibling INVOKER triggers): the classifier trigger is
-- SECURITY DEFINER and task_activity has NO user insert/update/delete policy — the trigger is the
-- SOLE writer, so a client can neither forge nor mutate the log. Owners get SELECT only (RLS).
-- Reads for the proactive dispatcher go through a service_role DEFINER RPC (like memories_for_user).
--
-- Content: task_text is a plaintext title snapshot, the same class as history.text (no new
-- encryption obligation). Like history/daily_state, task_activity stays OUT of create_backup /
-- restore_backup and the external pg_dump (AI/telemetry meta, not planner content). restore_backup
-- itself sets a txn-local GUC so its bulk upsert/soft-delete does not flood the log.
--
-- Down path (manual reversal):
--   drop trigger if exists log_task_activity on public.tasks;
--   drop function if exists public.log_task_activity();
--   drop function if exists public.task_activity_for_user(uuid, date);
--   drop function if exists public.task_quadrant(double precision, double precision);
--   drop table if exists public.task_activity;   -- policies + indexes drop with it
--   -- re-create restore_backup verbatim from 20260717120000_task_start_date.sql (drop the
--   --   set_config('todoclaw.suppress_activity', ...) line added below)

-- ============================================================================
-- (a) the log table — owner SELECT only; the DEFINER trigger is the sole writer
-- ============================================================================

create table public.task_activity (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  task_id    uuid not null,                         -- NO hard FK (history precedent): survives soft-delete
  kind       text not null,
  task_text  text not null,                         -- plaintext title snapshot (same class as history.text)
  detail     jsonb not null default '{}'::jsonb,    -- per-kind payload (from/to, quadrants, dates)
  created_at timestamptz not null default now()
);

comment on table public.task_activity is
  'Append-only log of task manipulations (create/complete/delete/move/re-date/pause/…), written '
  'ONLY by the log_task_activity() DEFINER trigger. Feeds the AI evening recap + BabyClaw chat '
  'context. Owner-readable; not backed up (like history/daily_state); newest-500/user retained.';

create index task_activity_user_created_idx on public.task_activity (user_id, created_at desc);
create index task_activity_task_created_idx on public.task_activity (task_id, created_at desc);

alter table public.task_activity enable row level security;

-- Owner SELECT only. Deliberately NO insert/update/delete policy and NO write grant — the DEFINER
-- trigger is the sole writer, so the log cannot be forged or tampered with from the client.
grant select on public.task_activity to authenticated;
create policy "task_activity_select_own" on public.task_activity
  for select to authenticated using (user_id = auth.uid());

-- ============================================================================
-- (b) quadrant label — the SAME names the user sees (src/lib/quadrants.ts /
--     chat-prompt.ts quadrant()): Do Now / Schedule / Errands / Someday, split at 0.5.
--     Stored y is high-at-top (important = y >= 0.5); the screen inversion is UI-only.
-- ============================================================================

create or replace function public.task_quadrant(p_x double precision, p_y double precision)
returns text language sql immutable as $$
  select case
    when p_x is null or p_y is null then null
    when p_y >= 0.5 and p_x >= 0.5  then 'Do Now'
    when p_y >= 0.5                 then 'Schedule'
    when p_x >= 0.5                 then 'Errands'
    else                                'Someday'
  end;
$$;

-- ============================================================================
-- (c) the classifier trigger — one semantic row per action, priority-ordered
-- ============================================================================

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

create trigger log_task_activity
  after insert or update on public.tasks
  for each row execute function public.log_task_activity();

-- ============================================================================
-- (d) dispatcher read RPC — service_role only, DEFINER (mirrors memories_for_user).
--     Buckets to the user's LOCAL day via their stored timezone.
-- ============================================================================

create or replace function public.task_activity_for_user(p_user_id uuid, p_local_date date)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('kind', a.kind, 'task_text', a.task_text, 'detail', a.detail, 'at', a.created_at)
      order by a.created_at
    ),
    '[]'::jsonb)
  from public.task_activity a
  join public.user_schedule us on us.user_id = a.user_id
  where a.user_id = p_user_id
    and (a.created_at at time zone us.timezone)::date = p_local_date;
$$;

revoke all on function public.task_activity_for_user(uuid, date) from public;
grant execute on function public.task_activity_for_user(uuid, date) to service_role;

-- ============================================================================
-- (e) restore_backup — body VERBATIM from 20260717120000_task_start_date.sql, plus ONE line:
--     a txn-local GUC the classifier trigger checks, so a restore's bulk upsert + soft-delete
--     doesn't flood the activity log with a "created 40 / deleted 12 today" burst. Nothing else
--     changed — the #299 legacy handling + start_date round-trip survive this re-create.
-- ============================================================================

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
