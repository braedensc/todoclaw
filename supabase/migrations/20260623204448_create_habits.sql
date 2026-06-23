-- Migration: create_habits
--
-- Intent: daily habits (Stage 3 feature). Mirrors EisenClaw's habit JSON shape
-- (planning/EISENCLAW-LOGIC-TO-PORT.md §9): a habit is { text, active, subtasks[] },
-- where each subtask is { id, text }. Subtasks are an embedded ordered list, not a
-- separate table — they have no independent identity, are always loaded with the habit,
-- and the original stored them inline; a jsonb array keeps that 1:1 fidelity without a
-- join. Per-day completion (habitDone / subtaskDone) lives in `daily_state`, NOT here.
--
-- Security model — identical to public.tasks (see 20260623131634_create_tasks.sql):
--   * RLS enabled; the ONLY policies are owner-scoped (`user_id = auth.uid()`) and only
--     for the `authenticated` role. Deny by default — no `using (true)` anywhere; `anon`
--     gets nothing.
--   * `user_id` defaults to `auth.uid()`; WITH CHECK forbids inserting/moving a row into
--     another user's account — no horizontal privilege escalation.
--   * NO delete policy or grant — a "delete" is a soft-delete (set `deleted_at`), so a
--     hard delete from the client is structurally impossible (doubly: no grant, no policy).
--
-- Down path (manual reversal):
--   drop table if exists public.habits;   -- policies + indexes drop with the table

create table public.habits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text        text not null,
  active      boolean not null default true,
  -- ordered list of { id: text, text: text }; embedded by design (see header).
  subtasks    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz   -- soft-delete: null = live
);

comment on table public.habits is
  'Daily habits. One owner per row (user_id = auth.uid()), RLS-enforced. subtasks is an '
  'embedded ordered jsonb array of {id,text}. Per-day completion lives in daily_state. '
  'deleted_at is soft-delete (null = live); no hard-delete policy exists by design.';

-- Hot path is "my live habits"; index for it (matches the tasks index).
create index habits_user_id_idx on public.habits (user_id) where deleted_at is null;

alter table public.habits enable row level security;

-- RLS sits on top of these grants; both are required. DELETE is deliberately omitted
-- (combined with the absent DELETE policy, hard-deletes from the client are impossible).
grant select, insert, update on public.habits to authenticated;

create policy "habits_select_own"
  on public.habits for select
  to authenticated
  using (user_id = auth.uid());

create policy "habits_insert_own"
  on public.habits for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "habits_update_own"
  on public.habits for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
