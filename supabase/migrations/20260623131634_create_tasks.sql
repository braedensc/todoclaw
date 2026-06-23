-- Migration: create_tasks
--
-- Intent: the first real table for Todoclaw — the `tasks` rows the Stage 1 walking
-- skeleton renders. Mirrors EisenClaw's per-task JSON shape in a proper relational
-- table, with Row Level Security so every row is owned by exactly one user (the
-- multi-tenant guarantee) and soft-delete so a "delete" is never destructive.
--
-- Security model (Stage 1 plan + docs/ARCHITECTURE.md):
--   * RLS enabled. Policies are scoped `to authenticated` and gated on
--     `user_id = auth.uid()` for reads (USING) and writes (WITH CHECK). There is
--     no `USING (true)` anywhere — deny by default. The `anon` (pre-login) role
--     gets no access at all.
--   * `user_id` defaults to `auth.uid()` and WITH CHECK forbids inserting or moving
--     a row into another user's account — no horizontal privilege escalation.
--   * NO delete policy is defined on purpose: with RLS on and no permissive DELETE
--     policy, hard-deletes from the client are structurally impossible. The app
--     "deletes" by setting `deleted_at` (an UPDATE). This is the strongest guard
--     against accidental data loss. (The service-role key bypasses RLS for admin
--     tasks/backups, but is never used by app code.)
--
-- Down path (manual reversal):
--   drop table if exists public.tasks;   -- policies + indexes drop with the table

create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text        text not null,
  x           double precision,
  y           double precision,
  due         timestamptz,
  staged      boolean not null default true,
  bucket      text,
  recurring   jsonb,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz   -- soft-delete: null = live
);

comment on table public.tasks is
  'Eisenhower-matrix tasks. One owner per row (user_id = auth.uid()), RLS-enforced. '
  'deleted_at is soft-delete (null = live); no hard-delete policy exists by design.';

-- The hot path is "my live tasks"; index for it.
create index tasks_user_id_idx on public.tasks (user_id) where deleted_at is null;

alter table public.tasks enable row level security;

-- Table privileges (RLS sits ON TOP of these grants; both are required). The
-- authenticated role may read/insert/update — RLS then narrows every row to
-- user_id = auth.uid(). DELETE is deliberately NOT granted: combined with the
-- absent DELETE policy, hard-deletes from the client are doubly impossible. The
-- anon (pre-login) role is granted nothing.
grant select, insert, update on public.tasks to authenticated;

-- Deny by default. These three policies are the ONLY access, all owner-scoped and
-- only for authenticated users. Hard DELETE is intentionally not granted (see header).
create policy "tasks_select_own"
  on public.tasks for select
  to authenticated
  using (user_id = auth.uid());

create policy "tasks_insert_own"
  on public.tasks for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "tasks_update_own"
  on public.tasks for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
