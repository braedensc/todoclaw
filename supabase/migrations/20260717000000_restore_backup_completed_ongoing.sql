-- Migration: restore_backup_completed_ongoing
--
-- Intent: fix restore_backup silently DROPPING two task columns added after its last re-create
-- (20260709040000_add_task_size.sql): completed_at (20260709120000_task_completed_at.sql) and
-- ongoing (20260713000000_ongoing_task_flag.sql). create_backup snapshots whole rows via
-- to_jsonb(t) — completed tasks included (its only filter is deleted_at is null) — so backups
-- already CARRY both fields; only the restore side enumerated a stale column list. Before this
-- fix:
--   * INSERT path (snapshot row no longer in tasks): completed_at lost → a completed task
--     resurrected as live; ongoing lost → an ongoing project degraded to a plain task.
--   * ON CONFLICT path (row still present): neither column was updated, so restore failed to
--     REWIND them to the snapshot — e.g. a task completed after the snapshot stayed completed
--     even though the snapshot says live. A content restore is point-in-time: the snapshot
--     value wins, exactly as it already does for text/x/y/due/….
--
-- Legacy snapshots (taken before 20260713000000, still restorable — backups are pruned by
-- COUNT (10 newest), never by age): those encode an ongoing project as recurring.ongoing = true
-- (+ optional targetEnd), a shape today's app no longer understands (it would render as a
-- recurring chore that resurfaces on a cadence). Restore now applies the SAME promotion that
-- migration applied to live rows — ongoing = true, recurring = null, soft targetEnd promoted to
-- a real due when due is empty — gated strictly on the snapshot predating the column (no
-- 'ongoing' key), so post-migration snapshots round-trip verbatim.
--
-- Everything else is verbatim from 20260709040000_add_task_size.sql. CREATE OR REPLACE keeps
-- the signature, so the existing grant to authenticated is preserved.
--
-- Down path (manual reversal):
--   -- re-run the restore_backup body from 20260709040000_add_task_size.sql

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
     completed_at, ongoing, created_at, deleted_at)
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
