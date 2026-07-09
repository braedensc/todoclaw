-- Intent: give tasks an optional coarse SIZE (effort) estimate — S / M / L / XL — used only by
-- Plan My Day as a soft guardrail against over-stuffing a day (rough effort vs. free hours), never
-- shown in the task UI. Hybrid model: BabyClaw/MCP set it at creation (like a due date); tasks
-- created any other way, and every pre-existing task, stay NULL and Plan My Day infers effort on
-- the fly. Nullable + additive, so it degrades gracefully everywhere a size is absent.
--
--   * tasks.size  new nullable TEXT constrained to the four bucket labels. NULL = "not estimated,
--     infer at plan time". The hour mapping (S≈15m, M≈45m, L≈2h, XL≈half-day) lives in the plan
--     prompt (its only consumer), not in the DB — the column stores the intent, not the arithmetic.
--   * create_backup  already snapshots size via to_jsonb(t) (no change needed).
--   * restore_backup  re-created to round-trip size: old snapshots that predate this column yield
--     e->>'size' = NULL, which satisfies both the nullable column and the CHECK.

alter table public.tasks
  add column size text;

comment on column public.tasks.size is
  'Optional coarse effort estimate — S/M/L/XL — set by BabyClaw/MCP at creation. NULL means unestimated (Plan My Day infers effort). Not surfaced in the task UI.';

-- Only the four bucket labels (or NULL). Keeps the model + any future writer honest.
alter table public.tasks
  add constraint tasks_size_valid check (size is null or size in ('S', 'M', 'L', 'XL'));

-- ============================================================================
-- restore_backup(p_backup_id) — unchanged except the tasks section now round-trips `size`
--   (added to the insert column list, the select, and the on-conflict update). CREATE OR REPLACE
--   preserves the existing grant to authenticated. Everything else is verbatim from
--   20260709021913_due_wall_clock_time.sql.
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
    (id, user_id, text, x, y, due, due_time, size, staged, bucket, recurring, created_at, deleted_at)
  select
    (e->>'id')::uuid,
    auth.uid(),
    e->>'text',
    (e->>'x')::double precision,
    (e->>'y')::double precision,
    left(e->>'due', 10)::date,
    (e->>'due_time')::time,
    e->>'size',
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
    size       = excluded.size,
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
--   alter table public.tasks drop constraint tasks_size_valid;
--   alter table public.tasks drop column size;
--   -- then re-run the restore_backup body from 20260709021913_due_wall_clock_time.sql
