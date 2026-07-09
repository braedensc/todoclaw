-- Intent: make due dates wall-clock values — a floating calendar DATE plus an optional local
-- clock TIME — interpreted in the user's timezone (user_schedule.timezone, the same authority
-- as the daily reset). ADR 2026-07-08-due-dates-wall-clock.
--
--   * tasks.due       timestamptz → date. Every writer (date picker, chat set_due_date) stores a
--     bare 'YYYY-MM-DD'; as timestamptz that became midnight UTC, and PostgREST returned
--     '2026-05-27T00:00:00+00:00' — which misses the floating-date branch PR #178 added to
--     src/lib/scoring.ts, so a task still read as overdue on its own due date once reloaded
--     from the DB (west of UTC). As a DATE the wire format IS the bare calendar date, so every
--     reader (client scoring + edge-function date math) takes the floating-date path.
--   * tasks.due_time  new nullable TIME — the optional time-of-day a task is due. A wall-clock
--     value, not an instant: "dentist at 10:30" stays 10:30 across DST shifts and timezone
--     moves. Projected to a real instant only at the edges (countdown chips, reminder fire
--     times) via src/lib/dates.ts dueInstant.
--   * restore_backup  re-created: restores due into the DATE column robustly for BOTH snapshot
--     vintages (old '2026-05-27T00:00:00+00:00' and new '2026-05-27') and round-trips due_time,
--     which create_backup already snapshots via to_jsonb(t).
--
-- All existing rows were written as midnight UTC, so (due at time zone 'utc')::date recovers
-- exactly the calendar date the user picked.

alter table public.tasks
  alter column due type date using (due at time zone 'utc')::date;

comment on column public.tasks.due is
  'Floating calendar due date — the day the user picked, in their own timezone. No instant semantics.';

alter table public.tasks
  add column due_time time;

comment on column public.tasks.due_time is
  'Optional wall-clock time-of-day the task is due, in the user''s timezone. Only meaningful with due set.';

-- A time-of-day without a date is meaningless.
alter table public.tasks
  add constraint tasks_due_time_requires_due check (due_time is null or due is not null);

-- ============================================================================
-- restore_backup(p_backup_id) — unchanged except the tasks section:
--   * due is restored via left(...,10)::date, total for both snapshot vintages regardless of
--     session timezone (both formats start 'YYYY-MM-DD'),
--   * due_time restored + upserted (absent in old snapshots → null, satisfying the CHECK).
-- CREATE OR REPLACE preserves the existing grant to authenticated.
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
  select data into v_data
  from public.backups
  where id = p_backup_id and user_id = auth.uid();

  if v_data is null then
    raise exception 'restore_backup: backup % not found', p_backup_id;
  end if;

  -- --- tasks ---------------------------------------------------------------
  insert into public.tasks
    (id, user_id, text, x, y, due, due_time, staged, bucket, recurring, created_at, deleted_at)
  select
    (e->>'id')::uuid,
    auth.uid(),
    e->>'text',
    (e->>'x')::double precision,
    (e->>'y')::double precision,
    left(e->>'due', 10)::date,
    (e->>'due_time')::time,
    (e->>'staged')::boolean,
    e->>'bucket',
    nullif(e->'recurring', 'null'::jsonb),
    (e->>'created_at')::timestamptz,
    null
  from jsonb_array_elements(v_data->'tasks') as e
  on conflict (id) do update set
    text       = excluded.text,
    x          = excluded.x,
    y          = excluded.y,
    due        = excluded.due,
    due_time   = excluded.due_time,
    staged     = excluded.staged,
    bucket     = excluded.bucket,
    recurring  = excluded.recurring,
    deleted_at = null;

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
--   alter table public.tasks drop constraint tasks_due_time_requires_due;
--   alter table public.tasks drop column due_time;
--   alter table public.tasks alter column due type timestamptz
--     using (due::timestamp at time zone 'utc');  -- back to midnight-UTC encoding
--   -- then re-run the restore_backup body from 20260702000000_backups.sql
