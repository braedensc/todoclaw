-- Migration: backups
--
-- Intent: Stage 5 (PR3) backup/restore. A user can snapshot their planner content and restore
-- it later. Two additive concerns:
--   (a) public.backups — owner-scoped snapshot rows (a jsonb copy of the user's tasks + habits
--       + schedule at a point in time), capped at MAX_BACKUPS newest per user.
--   (b) create_backup / restore_backup RPCs (SECURITY INVOKER) — the safe, atomic write path.
--
-- Restore is a CONTENT restore, reconciled with the app's data-safety invariants:
--   * ADR-0005 (no client hard-delete): restore never DELETEs a task/habit. Rows present now but
--     absent from the snapshot are SOFT-deleted (deleted_at = now) — recoverable. Restore uses
--     only INSERT/UPDATE on tasks/habits (their existing grants; no delete grant is needed).
--   * ADR-0012 (append-only history): public.history and public.daily_state are NOT touched by
--     restore. Your completion log and today's checkmarks are permanent — a content restore
--     rewinds tasks/habits/schedule, not your history.
--
-- backups grants SELECT, INSERT, DELETE (all owner-scoped). DELETE exists ONLY so a user can
-- prune their OWN snapshots (create_backup caps at MAX_BACKUPS) — a deliberate, narrow departure
-- from ADR-0005's no-delete stance, which protects PRIMARY data; backups are recoverable meta,
-- RLS-scoped to the owner. There is no UPDATE grant/policy — a snapshot is immutable once taken.
--
-- SECURITY INVOKER (Postgres default; stated for intent): the functions run as the CALLER, so RLS
-- still applies and auth.uid() is the real signed-in user. user_id is ALWAYS auth.uid() inside
-- and is NEVER a parameter — a caller cannot read or write another user's rows. search_path is
-- pinned to public (defense-in-depth, mirroring the Stage 3 merge RPCs).
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.restore_backup(uuid);
--   drop function if exists public.create_backup(text);
--   drop table if exists public.backups;   -- policies + index drop with the table
-- ----------------------------------------------------------------------------

create table public.backups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label      text,
  -- Snapshot blob: { version, tasks: [...], habits: [...], schedule: {...} }. A denormalized
  -- point-in-time copy of the owner's live rows; the source of truth for a restore.
  data       jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.backups is
  'Owner-scoped planner snapshots (Stage 5). data = jsonb copy of the user''s live tasks + '
  'habits + schedule at snapshot time. Written/pruned only via create_backup; applied via '
  'restore_backup (a CONTENT restore — never touches append-only history or daily_state).';

-- Newest-first list for the Backups panel, scoped to the owner.
create index backups_user_created_at_idx
  on public.backups (user_id, created_at desc);

alter table public.backups enable row level security;

-- RLS on top of grants; both required. SELECT (list) + INSERT (create) + DELETE (prune own
-- snapshots). No UPDATE — a snapshot is immutable.
grant select, insert, delete on public.backups to authenticated;

create policy "backups_select_own"
  on public.backups for select
  to authenticated
  using (user_id = auth.uid());

create policy "backups_insert_own"
  on public.backups for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "backups_delete_own"
  on public.backups for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- create_backup(p_label) — snapshot the caller's live content, prune to MAX_BACKUPS.
-- Returns the new backup id. All reads/writes are auth.uid()-scoped under RLS.
-- ============================================================================
create or replace function public.create_backup(p_label text default null)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_keep constant int := 10;  -- MAX_BACKUPS (EisenClaw parity, srv:31)
begin
  insert into public.backups (user_id, label, data)
  values (
    auth.uid(),
    p_label,
    jsonb_build_object(
      'version', 1,
      'tasks', coalesce(
        (select jsonb_agg(to_jsonb(t) order by t.created_at)
           from public.tasks t
          where t.user_id = auth.uid() and t.deleted_at is null),
        '[]'::jsonb
      ),
      'habits', coalesce(
        (select jsonb_agg(to_jsonb(h) order by h.created_at)
           from public.habits h
          where h.user_id = auth.uid() and h.deleted_at is null),
        '[]'::jsonb
      ),
      'schedule', (
        select to_jsonb(s) from public.user_schedule s where s.user_id = auth.uid()
      )
    )
  )
  returning id into v_id;

  -- Prune: keep only the newest v_keep snapshots for this user.
  delete from public.backups
  where user_id = auth.uid()
    and id not in (
      select id from public.backups
      where user_id = auth.uid()
      order by created_at desc
      limit v_keep
    );

  return v_id;
end;
$$;

-- ============================================================================
-- restore_backup(p_backup_id) — CONTENT restore from a snapshot, in one transaction:
--   * upsert snapshot tasks/habits (clearing deleted_at so a soft-deleted row comes back),
--   * soft-delete live tasks/habits NOT in the snapshot (an UPDATE — no delete grant needed),
--   * restore user_schedule timezone/config.
-- Deliberately does NOT touch public.history or public.daily_state (append-only / ephemeral).
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
    (id, user_id, text, x, y, due, staged, bucket, recurring, created_at, deleted_at)
  select
    (e->>'id')::uuid,
    auth.uid(),
    e->>'text',
    (e->>'x')::double precision,
    (e->>'y')::double precision,
    (e->>'due')::timestamptz,
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
  if v_data ? 'schedule' and v_data->'schedule' <> 'null'::jsonb then
    update public.user_schedule
    set timezone = coalesce(v_data->'schedule'->>'timezone', timezone),
        config   = coalesce(v_data->'schedule'->'config', config)
    where user_id = auth.uid();
  end if;
end;
$$;

grant execute on function public.create_backup(text) to authenticated;
grant execute on function public.restore_backup(uuid) to authenticated;
