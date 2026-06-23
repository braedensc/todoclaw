-- Migration: create_user_schedule
--
-- Intent: one row per user holding their schedule config — replaces EisenClaw's
-- data/user-schedule-<userId>.json (planning/EISENCLAW-LOGIC-TO-PORT.md §12, and the sample
-- planning/eisenclaw-export/data/user-schedule-braeden.json). Read by Plan My Day (a later
-- AI stage) and by the daily-reset logic (for the timezone).
--
-- WHY `timezone` is a hoisted top-level column (not buried in config jsonb):
--   It is load-bearing for correctness — the daily reset and daily_state.date are computed
--   in the user's local timezone (fixes the UTC-vs-local bug, § Discrepancies #3). Hoisting
--   it gives it a NOT NULL guarantee and a CHECK, and lets the reset path read it without a
--   jsonb extract. Default 'UTC' is a SAFE fallback, but the app should seed the user's real
--   IANA zone (e.g. 'America/New_York') on first login. The rest of the schedule
--   (location, weekday/weekend windows, running) stays in `config` jsonb — it is only read
--   by Plan My Day and needs no columnar access.
--
-- Default-row creation is app-side (upsert on first authenticated load, mirroring the
-- use-tasks insert pattern), deliberately NOT a trigger on auth.users: a SECURITY DEFINER
-- trigger that errors would break signup entirely (a documented Supabase footgun).
--
-- Security model — same owner-scoped RLS as public.tasks. One row per user (PK user_id);
-- no soft-delete, no DELETE grant/policy.
--
-- Down path (manual reversal):
--   drop table if exists public.user_schedule;
--   drop function if exists public.set_updated_at();

-- Reusable trigger to keep updated_at fresh on every UPDATE (first use; future mutable
-- tables can reuse it). `create or replace` so re-running migrations is idempotent.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.user_schedule (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- IANA timezone name; load-bearing for the timezone-correct daily reset (see header).
  timezone    text not null default 'UTC' check (length(btrim(timezone)) > 0),
  -- location / weekday / weekend / running — the Plan My Day context. Shape mirrors
  -- user-schedule-braeden.json minus the hoisted timezone.
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.user_schedule is
  'Per-user schedule config (one row per user). timezone is hoisted out of config because '
  'it drives the timezone-correct daily reset. config holds the Plan My Day context. '
  'Default row is created app-side via upsert, not an auth.users trigger.';

create trigger user_schedule_set_updated_at
  before update on public.user_schedule
  for each row execute function public.set_updated_at();

alter table public.user_schedule enable row level security;

-- RLS on top of grants; both required. No DELETE.
grant select, insert, update on public.user_schedule to authenticated;

create policy "user_schedule_select_own"
  on public.user_schedule for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_schedule_insert_own"
  on public.user_schedule for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_schedule_update_own"
  on public.user_schedule for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
