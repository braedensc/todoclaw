-- Migration: history_and_daily_state_rpc
--
-- Intent: the Done-tab data layer for Stage 3 (PR6). Two additive concerns in one
-- migration (the ONLY migration in Stage 3):
--
--   (a) public.history — the permanent, append-only completion log behind the Done tab.
--   (b) atomic merge RPCs over public.daily_state — the safe write path for the per-day
--       completion maps (fixes the jsonb-clobber race; see below).
--
-- ============================================================================
-- (a) public.history — denormalized, append-only permanent log
-- ============================================================================
--
-- WHY denormalized (snapshot text/bucket on the row, task_id has NO hard FK):
--   The Done tab is a PERMANENT record. The app only ever SOFT-deletes tasks
--   (ADR-0005: no client hard-delete, no DELETE grant). When a task is later
--   soft-deleted from the Done tab, its history row must SURVIVE — so the row carries
--   its own snapshot of `text` and `bucket` and is the source of truth. `task_id` is
--   kept (nullable, no FK) only to drive restore-eligibility (is it still in today's
--   `done` map?); the row does not depend on the task row continuing to exist.
--
-- WHY append-only / immutable:
--   History is an audit-style log. There is deliberately NO UPDATE and NO DELETE grant
--   and NO update/delete policy — once written, a completion is permanent. "Restore"
--   does NOT remove a history row (it only flips today's daily_state.done); "delete from
--   the Done tab" SOFT-deletes the TASK, never the history row. So nothing the app does
--   ever mutates or removes history.
--
-- Index (user_id, completed_at desc) serves the newest-first Done-tab query directly.
--
-- ============================================================================
-- (b) Atomic merge RPCs over public.daily_state (SECURITY INVOKER)
-- ============================================================================
--
-- WHY RPCs instead of a client read-modify-write:
--   daily_state stores done/done_at/habit_done/subtask_done as jsonb objects on ONE row
--   per (user, local day). A client that reads the row, edits a map in JS, and writes the
--   whole map back races any concurrent write to the SAME row (task-done racing a
--   habit-check clobbers the other's edit — the jsonb-clobber hazard). Doing the merge
--   server-side with `<map> || jsonb_build_object(key, value)` under the row lock acquired
--   by the UPDATE makes each toggle atomic against the CURRENT row value: concurrent
--   toggles to different keys both survive.
--
-- WHY SECURITY INVOKER (the default — stated explicitly here for intent):
--   The functions run as the CALLER, so RLS still applies and auth.uid() is the real
--   signed-in user. user_id is ALWAYS auth.uid() inside the function and is NEVER a
--   parameter — a caller cannot write another user's row. (A SECURITY DEFINER function
--   would bypass RLS and run as the owner; we explicitly do NOT want that here.)
--
-- p_date is the USER's LOCAL calendar day (computed client-side with
-- src/lib/dates.ts localDateInTZ(tz)), mirroring daily_state.date — never server-UTC.
-- Each RPC first ensures today's row exists (insert ... on conflict do nothing), then
-- merges. set_task_done additionally folds the history insert into the same transaction,
-- so there is no done-without-history window.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.set_daily_flag(date, text, text, boolean);
--   drop function if exists public.set_task_undone(date, uuid);
--   drop function if exists public.set_task_done(date, uuid, text, text);
--   drop table if exists public.history;
-- ----------------------------------------------------------------------------

-- ============================================================================
-- (a) history table
-- ============================================================================

create table public.history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The task this completion came from. Nullable, NO hard FK on purpose: the snapshot
  -- (text/bucket) is the source of truth, so the row survives a later task soft-delete.
  -- Used only to compute restore-eligibility against today's daily_state.done map.
  task_id      uuid,
  text         text not null,            -- snapshot of the task text at completion time
  bucket       text,                     -- snapshot of the task bucket (nullable)
  completed_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table public.history is
  'Permanent, append-only completion log behind the Done tab. Denormalized (text/bucket '
  'snapshotted on the row, task_id has no FK) so completions survive task soft-delete. '
  'No UPDATE/DELETE grant or policy — immutable by design.';

-- Newest-first Done-tab read: order by completed_at desc, scoped to the owner.
create index history_user_completed_at_idx
  on public.history (user_id, completed_at desc);

alter table public.history enable row level security;

-- RLS on top of grants; both required. SELECT + INSERT only — NO update, NO delete
-- (immutable append-only log; there is intentionally no update/delete policy either).
grant select, insert on public.history to authenticated;

create policy "history_select_own"
  on public.history for select
  to authenticated
  using (user_id = auth.uid());

create policy "history_insert_own"
  on public.history for insert
  to authenticated
  with check (user_id = auth.uid());

-- ============================================================================
-- (b) atomic merge RPCs over daily_state (SECURITY INVOKER)
-- ============================================================================

-- Mark a task done TODAY, atomically. In one transaction:
--   1. ensure today's daily_state row exists,
--   2. merge done[p_task_id]=true AND done_at[p_task_id]=<now ISO> into that row,
--   3. append a permanent history row (snapshotting text + bucket).
-- Folding the history insert in keeps mark-done atomic (no done-without-history window).
-- user_id is auth.uid() everywhere; never a parameter.
create or replace function public.set_task_done(
  p_date    date,
  p_task_id uuid,
  p_text    text,
  p_bucket  text
)
returns void
language plpgsql
security invoker
-- Lock search_path so the function always resolves public objects regardless of caller
-- session settings (defense-in-depth even under INVOKER).
set search_path = public
as $$
begin
  insert into public.daily_state (user_id, date)
  values (auth.uid(), p_date)
  on conflict (user_id, date) do nothing;

  update public.daily_state
  set done    = done    || jsonb_build_object(p_task_id::text, true),
      done_at = done_at || jsonb_build_object(p_task_id::text, to_jsonb(now()::text))
  where user_id = auth.uid()
    and date = p_date;

  insert into public.history (task_id, text, bucket)
  values (p_task_id, p_text, p_bucket);
end;
$$;

-- Restore a task: flip today's done[p_task_id]=false and clear done_at[p_task_id].
-- Append-only history is NOT touched (the completion record is permanent).
create or replace function public.set_task_undone(
  p_date    date,
  p_task_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.daily_state (user_id, date)
  values (auth.uid(), p_date)
  on conflict (user_id, date) do nothing;

  update public.daily_state
  set done    = done    || jsonb_build_object(p_task_id::text, false),
      done_at = done_at - p_task_id::text
  where user_id = auth.uid()
    and date = p_date;
end;
$$;

-- General per-day boolean toggle for the habit_done / subtask_done maps. Used by the
-- habits PR later, so it needs no new migration. p_key is the map key
-- (habitId for habit_done, "habitId:subtaskId" for subtask_done). p_map is validated to
-- the two allowed map names so this can never write done/done_at.
create or replace function public.set_daily_flag(
  p_date  date,
  p_map   text,
  p_key   text,
  p_value boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_map not in ('habit_done', 'subtask_done') then
    raise exception 'set_daily_flag: invalid map %, expected habit_done or subtask_done', p_map;
  end if;

  insert into public.daily_state (user_id, date)
  values (auth.uid(), p_date)
  on conflict (user_id, date) do nothing;

  -- p_map is whitelisted above, so the dynamic column reference is safe (no injection
  -- surface — it is one of exactly two literal column names).
  execute format(
    'update public.daily_state
       set %1$I = %1$I || jsonb_build_object($1, $2)
     where user_id = auth.uid() and date = $3',
    p_map
  )
  using p_key, p_value, p_date;
end;
$$;

grant execute on function public.set_task_done(date, uuid, text, text) to authenticated;
grant execute on function public.set_task_undone(date, uuid) to authenticated;
grant execute on function public.set_daily_flag(date, text, text, boolean) to authenticated;
