-- Migration: ai_usage_and_budget
--
-- Intent: the cost guardrails for Stage 4 AI (PR2). Two concerns:
--
--   (a) public.ai_usage — per-user, append-only AI request log. Drives PER-USER RATE
--       LIMITS (e.g. chat 30/hour + 100/day, plan_my_day 10/day). One row per request.
--   (b) public.ai_budget_ledger — a single GLOBAL row per calendar month tracking total
--       spend in micro-dollars. Drives the GLOBAL MONTHLY BUDGET KILL-SWITCH that protects
--       the owner's Anthropic key from a runaway loop. NOT user-readable.
--
-- All AI runs on the OWNER's key for every signed-in (invited, trusted) user — there is no
-- per-user key or BYOK (ADR-0014). These guardrails are what bound the owner's exposure.
--
-- ============================================================================
-- (a) public.ai_usage — per-user request log (SECURITY INVOKER access)
-- ============================================================================
--
-- One row per AI request. Rate limiting counts the caller's own rows inside a trailing
-- window (last hour / last day) for a feature. Append-only event rows (not a single mutable
-- counter) avoid a read-modify-write race on a counter row and need no cron reset — the
-- trailing-window count is self-expiring. token columns are observability only (the
-- kill-switch uses the GLOBAL ledger, not these), so a user fudging their own token numbers
-- is harmless; they are filled in after the model call via ai_usage_record_tokens.
--
-- Same owner-scoped RLS pattern as every other table (ADR-0005/0007): RLS on; policies
-- scoped `to authenticated` on `user_id = auth.uid()`; user_id defaults to auth.uid().
-- grant select/insert/update (update only so the post-call token backfill works) — NO delete.
--
-- ============================================================================
-- (b) public.ai_budget_ledger — global monthly spend (SECURITY DEFINER access ONLY)
-- ============================================================================
--
-- A single row per 'YYYY-MM' period accumulating spend in micro-dollars (millionths of USD).
-- This is GLOBAL (not per-user) state, so RLS can't express "only the system may touch it".
-- Instead the table has RLS enabled with NO grants and NO policies → it is invisible to the
-- anon/authenticated roles entirely. The ONLY path to it is the two SECURITY DEFINER
-- functions below, which run as the table owner (postgres) and so can read/write it while
-- still deriving auth.uid() from the request JWT (a DEFINER function does not change who the
-- caller is — only its privilege). This keeps the SERVICE-ROLE KEY out of the Edge Functions
-- entirely: the functions reach the ledger through these RPCs under the caller's JWT, never
-- an admin client. Monthly reset is cron-free: a new month is simply a new PK row at zero
-- (the same "row existence is the reset" philosophy as daily_state, ADR-0007).
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.ai_budget_add(bigint);
--   drop function if exists public.ai_budget_check(bigint);
--   drop function if exists public.ai_usage_record_tokens(uuid, integer, integer);
--   drop function if exists public.ai_usage_check_and_record(text, integer, integer);
--   drop table if exists public.ai_budget_ledger;
--   drop table if exists public.ai_usage;
-- ----------------------------------------------------------------------------

-- ============================================================================
-- (a) ai_usage
-- ============================================================================

create table public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  feature       text not null,                 -- 'chat' | 'plan_my_day'
  called_at     timestamptz not null default now(),
  input_tokens  integer not null default 0,    -- backfilled post-call (observability only)
  output_tokens integer not null default 0
);

comment on table public.ai_usage is
  'Per-user, append-only AI request log. Rate limiting counts the owner''s rows in a trailing '
  'window per feature. token columns are observability only — the budget kill-switch uses the '
  'global ai_budget_ledger, not these. No delete grant/policy.';

-- Rate-limit reads count the caller's rows for one feature in a trailing window.
create index ai_usage_user_feature_time_idx
  on public.ai_usage (user_id, feature, called_at desc);

alter table public.ai_usage enable row level security;

-- RLS on top of grants. select/insert/update only (update backfills token counts);
-- DELETE deliberately not granted (append-only, mirrors the project-wide pattern).
grant select, insert, update on public.ai_usage to authenticated;

create policy "ai_usage_select_own"
  on public.ai_usage for select
  to authenticated
  using (user_id = auth.uid());

create policy "ai_usage_insert_own"
  on public.ai_usage for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "ai_usage_update_own"
  on public.ai_usage for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================================
-- (b) ai_budget_ledger
-- ============================================================================

create table public.ai_budget_ledger (
  period       text primary key,                 -- 'YYYY-MM' (UTC) — a new month = a new row
  spent_micros bigint not null default 0,         -- accumulated spend, millionths of a USD
  updated_at   timestamptz not null default now()
);

comment on table public.ai_budget_ledger is
  'GLOBAL monthly AI spend (micro-dollars) behind the budget kill-switch. RLS on with NO '
  'grants/policies → invisible to app roles; reachable ONLY via the SECURITY DEFINER '
  'functions ai_budget_check / ai_budget_add. Cron-free monthly reset (a new period = a new row).';

alter table public.ai_budget_ledger enable row level security;
-- Intentionally NO grants and NO policies: the table is unreachable by anon/authenticated.

-- ============================================================================
-- Functions
-- ============================================================================

-- Per-user rate-limit check + record (SECURITY INVOKER: runs as the caller, RLS applies,
-- user_id is auth.uid() and NEVER a parameter). Counts the caller's rows for p_feature in
-- the trailing hour and day; raises 'rate_limited_*' if at/over the limit; otherwise inserts
-- one request row and returns its id (so the post-call token backfill can target it).
create or replace function public.ai_usage_check_and_record(
  p_feature    text,
  p_hour_limit integer,
  p_day_limit  integer
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_hour integer;
  v_day  integer;
  v_id   uuid;
begin
  select count(*) into v_hour
    from public.ai_usage
    where user_id = auth.uid()
      and feature = p_feature
      and called_at > now() - interval '1 hour';
  if v_hour >= p_hour_limit then
    raise exception 'rate_limited_hour' using errcode = 'P0001';
  end if;

  select count(*) into v_day
    from public.ai_usage
    where user_id = auth.uid()
      and feature = p_feature
      and called_at > now() - interval '1 day';
  if v_day >= p_day_limit then
    raise exception 'rate_limited_day' using errcode = 'P0001';
  end if;

  insert into public.ai_usage (feature) values (p_feature)  -- user_id defaults to auth.uid()
  returning id into v_id;
  return v_id;
end;
$$;

-- Backfill the token counts on a request row after the model responds (observability).
-- Scoped to the caller's own row; a no-op if the id isn't theirs.
create or replace function public.ai_usage_record_tokens(
  p_id     uuid,
  p_input  integer,
  p_output integer
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.ai_usage
    set input_tokens = p_input, output_tokens = p_output
    where id = p_id and user_id = auth.uid();
end;
$$;

-- Global budget check (SECURITY DEFINER: runs as owner so it can read the no-grant ledger).
-- Returns remaining micro-dollars for the current UTC month (negative ⇒ kill-switch tripped).
-- auth.uid() still identifies the caller (JWT claim), used only as an authenticated guard.
create or replace function public.ai_budget_check(p_cap_micros bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent  bigint;
  v_period text := to_char((now() at time zone 'utc'), 'YYYY-MM');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select coalesce(spent_micros, 0) into v_spent
    from public.ai_budget_ledger where period = v_period;
  return p_cap_micros - coalesce(v_spent, 0);
end;
$$;

-- Global budget increment (SECURITY DEFINER). Adds this call's cost to the current UTC
-- month's row atomically (upsert under the row lock the conflict path takes).
create or replace function public.ai_budget_add(p_micros bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := to_char((now() at time zone 'utc'), 'YYYY-MM');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  insert into public.ai_budget_ledger (period, spent_micros)
  values (v_period, p_micros)
  on conflict (period) do update
    set spent_micros = public.ai_budget_ledger.spent_micros + excluded.spent_micros,
        updated_at = now();
end;
$$;

-- Execute grants. The DEFINER functions are revoked from public first so only authenticated
-- (a logged-in user, via the Edge Function carrying their JWT) can reach the ledger.
grant execute on function public.ai_usage_check_and_record(text, integer, integer) to authenticated;
grant execute on function public.ai_usage_record_tokens(uuid, integer, integer) to authenticated;

revoke all on function public.ai_budget_check(bigint) from public;
revoke all on function public.ai_budget_add(bigint) from public;
grant execute on function public.ai_budget_check(bigint) to authenticated;
grant execute on function public.ai_budget_add(bigint) to authenticated;
