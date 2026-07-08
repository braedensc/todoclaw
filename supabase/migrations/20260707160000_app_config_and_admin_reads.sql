-- Migration: app_config_and_admin_reads
--
-- Intent: back the owner-only Admin panel. Two concerns:
--
--   (1) public.app_config — a SINGLE-ROW table holding the OWNER-tunable AI guardrail knobs
--       (global + per-user monthly budget caps and the per-feature rate limits), seeded to the
--       EXACT compile-time constants in _shared/guardrails.ts. It is the storage that makes those
--       caps runtime-editable; the WRITE path (app_config_set) lands in a follow-up migration, so
--       shipping this alone is behavior-identical. Enforcement is UNCHANGED: guardrails.ts already
--       passes caps/limits AS PARAMETERS into the existing SQL RPCs (ai_budget_check(p_cap_micros),
--       ai_usage_check_and_record(..., p_hour_limit, p_day_limit)), so this table merely supplies
--       those parameter values (with a hard fallback to the constants in TS if the read ever fails).
--       The per-call $0.20 clamp stays hardcoded in ai_budget_add (20260706000000) — it is a FIXED
--       safety rail, never an editable knob.
--
--   (2) Owner-only READ RPCs behind the panel: current config, this month's GLOBAL spend, a
--       per-user spend roster, and system stats. Everything cross-user / global / auth.users is
--       SECURITY DEFINER granted to service_role ONLY (reached by the admin Edge Function's admin
--       client AFTER it verifies OWNER_USER_ID — the same fencing as the invite / *_for_user RPCs).
--       app_config_get is ALSO granted to authenticated because the (non-secret) caps must be
--       readable on the AI hot path under the caller's JWT.
--
-- HARD_MAX ceilings are mirrored in supabase/functions/_shared/guardrails-config.ts (HARD_MAX) —
-- KEEP THE TWO IN SYNC: global ≤ $100 (100_000_000 micros), per-user ≤ $50 (50_000_000),
-- chat/hr ≤ 200, chat/day ≤ 2000, plan/hr ≤ 50, plan/day ≤ 50. The CHECK constraints below are
-- born with the table, so app_config can never hold an out-of-range value even before the write
-- RPC exists — the first of the four defense-in-depth clamp layers (table CHECK → app_config_set
-- least/greatest → edge-fn Zod → loadConfig read-clamp).
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.admin_system_stats();
--   drop function if exists public.ai_user_spend_roster(text);
--   drop function if exists public.ai_budget_status_admin();
--   drop function if exists public.app_config_get();
--   drop table if exists public.app_config;
-- ----------------------------------------------------------------------------

-- ============================================================================
-- (1) app_config — single-row, owner-tunable guardrail knobs
-- ============================================================================

create table public.app_config (
  id                       integer primary key default 1 check (id = 1),  -- singleton
  global_budget_cap_micros bigint  not null default 20000000
    check (global_budget_cap_micros between 0 and 100000000),             -- HARD_MAX $100
  user_budget_cap_micros   bigint  not null default 10000000
    check (user_budget_cap_micros between 0 and 50000000),                -- HARD_MAX $50
  chat_hour_limit          integer not null default 30   check (chat_hour_limit between 0 and 200),
  chat_day_limit           integer not null default 100  check (chat_day_limit between 0 and 2000),
  plan_hour_limit          integer not null default 10   check (plan_hour_limit between 0 and 50),
  plan_day_limit           integer not null default 10   check (plan_day_limit between 0 and 50),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users (id) on delete set null,
  -- The per-user sub-cap must stay ≤ the global pool to mean anything (mirrors guardrails.ts).
  check (user_budget_cap_micros <= global_budget_cap_micros)
);

comment on table public.app_config is
  'Single-row (id=1) owner-tunable AI guardrail knobs (global + per-user monthly budget caps, '
  'per-feature rate limits). Seeded to the _shared/guardrails.ts constants; read on the AI hot '
  'path via app_config_get and written by a service_role-only DEFINER RPC. CHECK constraints '
  'clamp every value to the HARD_MAX ceilings mirrored in _shared/guardrails-config.ts.';

-- Seed the singleton with defaults == the current guardrails.ts constants (behavior-identical).
insert into public.app_config (id) values (1) on conflict (id) do nothing;

alter table public.app_config enable row level security;
-- RLS on, NO policies: the table is unreachable directly by anon/authenticated. Reads go through
-- app_config_get (SECURITY DEFINER, granted below); writes through a service_role-only DEFINER RPC
-- (follow-up migration). Matches the ai_budget_ledger fencing.

-- ============================================================================
-- (2) Read RPCs
-- ============================================================================

-- Current config as JSON (camelCase keys for the TS callers). SECURITY DEFINER so it can read the
-- no-policy table. Granted to authenticated (the AI hot path reads it under the caller's JWT) AND
-- service_role (the admin Edge Function). Returns null only if the singleton row is missing, which
-- the TS loader treats as "read failed" → falls back to the compile-time constants.
create or replace function public.app_config_get()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'globalBudgetCapMicros', global_budget_cap_micros,
    'userBudgetCapMicros',   user_budget_cap_micros,
    'chatHourLimit',         chat_hour_limit,
    'chatDayLimit',          chat_day_limit,
    'planHourLimit',         plan_hour_limit,
    'planDayLimit',          plan_day_limit,
    'updatedAt',             updated_at,
    'updatedBy',             updated_by
  )
  from public.app_config where id = 1;
$$;

revoke all on function public.app_config_get() from public;
grant execute on function public.app_config_get() to authenticated, service_role;

-- This month's GLOBAL spend vs the configured cap (the kill-switch counter). The first read path to
-- the no-grant ai_budget_ledger's SPENT value (ai_budget_check only returns REMAINING). service_role
-- only — owner-gated at the Edge Function.
create or replace function public.ai_budget_status_admin()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := to_char((now() at time zone 'utc'), 'YYYY-MM');
  v_spent  bigint;
  v_cap    bigint;
begin
  select coalesce(spent_micros, 0) into v_spent
    from public.ai_budget_ledger where period = v_period;
  v_spent := coalesce(v_spent, 0);
  select global_budget_cap_micros into v_cap from public.app_config where id = 1;
  return jsonb_build_object(
    'period',          v_period,
    'spentMicros',     v_spent,
    'capMicros',       v_cap,
    'remainingMicros', v_cap - v_spent
  );
end;
$$;

revoke all on function public.ai_budget_status_admin() from public;
grant execute on function public.ai_budget_status_admin() to service_role;

-- Per-user spend roster for a period (default: current UTC month), highest spender first. Joins
-- auth.users for the email (DEFINER runs as owner, which may read auth.users) — PRIVILEGED, so this
-- is service_role only and never granted to authenticated. LEFT JOIN so a ledger row for a
-- since-deleted account still lists (email null).
create or replace function public.ai_user_spend_roster(p_period text default null)
returns table (user_id uuid, email text, spent_micros bigint, updated_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select l.user_id, u.email::text, l.spent_micros, l.updated_at
  from public.ai_user_budget_ledger l
  left join auth.users u on u.id = l.user_id
  where l.period = coalesce(p_period, to_char((now() at time zone 'utc'), 'YYYY-MM'))
  order by l.spent_micros desc, l.updated_at desc;
$$;

revoke all on function public.ai_user_spend_roster(text) from public;
grant execute on function public.ai_user_spend_roster(text) to service_role;

-- Roll-up counts for the panel's "system status" block. service_role only.
create or replace function public.admin_system_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_users        integer;
  v_invite_total integer;
  v_invite_active integer;
  v_redemptions  integer;
  v_push         integer;
  v_last_message timestamptz;
begin
  select count(*) into v_users from auth.users;
  select count(*) into v_invite_total from public.invites;
  select count(*) into v_invite_active from public.invites
    where not revoked
      and (expires_at is null or expires_at > now())
      and used_count < max_uses;
  select count(*) into v_redemptions from public.invite_redemptions;
  select count(*) into v_push from public.push_subscriptions;
  select max(created_at) into v_last_message from public.messages;
  return jsonb_build_object(
    'userCount',       v_users,
    'inviteTotal',     v_invite_total,
    'inviteActive',    v_invite_active,
    'redemptionCount', v_redemptions,
    'pushSubCount',    v_push,
    'lastMessageAt',   v_last_message
  );
end;
$$;

revoke all on function public.admin_system_stats() from public;
grant execute on function public.admin_system_stats() to service_role;
