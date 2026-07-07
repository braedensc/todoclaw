-- Migration: ai_guardrails_system_rpcs
--
-- Intent: the SYSTEM counterparts of the AI guardrail RPCs, for the proactive dispatcher (ADR-0031).
-- The interactive RPCs (20260624010000 + 20260706000000 hardening) derive the user from auth.uid()
-- and raise 'not_authenticated' when it is null — correct for a request carrying a user's JWT, but a
-- hard blocker for dispatch-messages, which runs from a cron with NO user JWT. These variants take an
-- explicit p_user_id and are locked to `service_role` (revoked from public AND authenticated), so ONLY
-- the dispatcher's admin client (_shared/admin.ts, ADR-0030) can reach them — exactly the fencing the
-- invite RPCs use. They are otherwise byte-for-byte the same logic (same ledgers, same clamp, same
-- window counts, same caps passed in), so proactive AI spends against the identical $20 global / $10
-- per-user pools and per-feature rate limits as interactive AI — one budget, two entry points.
--
-- Why service_role-only (not authenticated): each takes p_user_id and acts on THAT user. If an
-- authenticated user could call them, they could pass someone else's id to drain their budget, record
-- usage on their behalf, or overwrite their daily plan. Only the trusted backend may name a user.
--
-- Functions (all SECURITY DEFINER, execute granted to service_role ONLY):
--   • ai_budget_check_system(p_cap_micros)               — global pool remaining (no auth.uid() guard).
--   • ai_user_budget_check_for_user(p_user_id, p_cap)    — that user's per-user pool remaining.
--   • ai_usage_check_and_record_for_user(p_user_id, …)   — that user's rate-limit check + record.
--   • ai_budget_add_for_user(p_user_id, p_micros)        — bounded add to BOTH ledgers for that user.
--   • save_daily_plan_for_user(p_user_id, p_date, p_plan) — write that user's daily plan.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.save_daily_plan_for_user(uuid, date, jsonb);
--   drop function if exists public.ai_budget_add_for_user(uuid, bigint);
--   drop function if exists public.ai_usage_check_and_record_for_user(uuid, text, integer, integer);
--   drop function if exists public.ai_user_budget_check_for_user(uuid, bigint);
--   drop function if exists public.ai_budget_check_system(bigint);
-- ----------------------------------------------------------------------------

-- Global pool remaining (kill-switch input). Mirrors ai_budget_check but with no auth.uid() guard —
-- the guard here is the service_role-only grant. Reads the no-grant global ledger (DEFINER = owner).
create or replace function public.ai_budget_check_system(p_cap_micros bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent  bigint;
  v_period text := to_char((now() at time zone 'utc'), 'YYYY-MM');
begin
  select coalesce(spent_micros, 0) into v_spent
    from public.ai_budget_ledger where period = v_period;
  return p_cap_micros - coalesce(v_spent, 0);
end;
$$;

-- That user's per-user pool remaining. Mirrors ai_user_budget_check but keyed on p_user_id.
create or replace function public.ai_user_budget_check_for_user(p_user_id uuid, p_cap_micros bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent  bigint;
  v_period text := to_char((now() at time zone 'utc'), 'YYYY-MM');
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = 'P0001';
  end if;
  select coalesce(spent_micros, 0) into v_spent
    from public.ai_user_budget_ledger
    where period = v_period and user_id = p_user_id;
  return p_cap_micros - coalesce(v_spent, 0);
end;
$$;

-- That user's rate-limit check + record. Mirrors ai_usage_check_and_record but counts p_user_id's
-- rows and inserts with an explicit user_id. DEFINER runs as the table owner, so the cross-user
-- insert bypasses RLS (as intended for the system path).
create or replace function public.ai_usage_check_and_record_for_user(
  p_user_id    uuid,
  p_feature    text,
  p_hour_limit integer,
  p_day_limit  integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hour integer;
  v_day  integer;
  v_id   uuid;
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = 'P0001';
  end if;

  select count(*) into v_hour
    from public.ai_usage
    where user_id = p_user_id
      and feature = p_feature
      and called_at > now() - interval '1 hour';
  if v_hour >= p_hour_limit then
    raise exception 'rate_limited_hour' using errcode = 'P0001';
  end if;

  select count(*) into v_day
    from public.ai_usage
    where user_id = p_user_id
      and feature = p_feature
      and called_at > now() - interval '1 day';
  if v_day >= p_day_limit then
    raise exception 'rate_limited_day' using errcode = 'P0001';
  end if;

  insert into public.ai_usage (user_id, feature) values (p_user_id, p_feature)
  returning id into v_id;
  return v_id;
end;
$$;

-- Bounded add to BOTH ledgers for p_user_id. Mirrors the hardened ai_budget_add (Issue 1 clamp +
-- Issue 3 per-user ledger), keyed on p_user_id instead of auth.uid().
create or replace function public.ai_budget_add_for_user(p_user_id uuid, p_micros bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := to_char((now() at time zone 'utc'), 'YYYY-MM');
  v_micros bigint;
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = 'P0001';
  end if;
  if p_micros < 0 then
    raise exception 'invalid_micros' using errcode = 'P0001';
  end if;
  v_micros := least(p_micros, 200000);  -- same $0.20 per-call ceiling as the interactive path

  insert into public.ai_budget_ledger (period, spent_micros)
  values (v_period, v_micros)
  on conflict (period) do update
    set spent_micros = public.ai_budget_ledger.spent_micros + excluded.spent_micros,
        updated_at = now();

  insert into public.ai_user_budget_ledger (period, user_id, spent_micros)
  values (v_period, p_user_id, v_micros)
  on conflict (period, user_id) do update
    set spent_micros = public.ai_user_budget_ledger.spent_micros + excluded.spent_micros,
        updated_at = now();
end;
$$;

-- Write p_user_id's daily plan. Mirrors save_daily_plan (20260703000000) keyed on p_user_id; used by
-- the dispatcher to persist the generated morning plan into today's daily_state row.
create or replace function public.save_daily_plan_for_user(p_user_id uuid, p_date date, p_plan jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = 'P0001';
  end if;
  insert into public.daily_state (user_id, date)
  values (p_user_id, p_date)
  on conflict (user_id, date) do nothing;

  update public.daily_state
    set plan = p_plan
    where user_id = p_user_id and date = p_date;
end;
$$;

-- ============================================================================
-- Fence: service_role ONLY (revoke from public, which includes anon + authenticated).
-- ============================================================================
revoke all on function public.ai_budget_check_system(bigint) from public;
revoke all on function public.ai_user_budget_check_for_user(uuid, bigint) from public;
revoke all on function public.ai_usage_check_and_record_for_user(uuid, text, integer, integer) from public;
revoke all on function public.ai_budget_add_for_user(uuid, bigint) from public;
revoke all on function public.save_daily_plan_for_user(uuid, date, jsonb) from public;

grant execute on function public.ai_budget_check_system(bigint) to service_role;
grant execute on function public.ai_user_budget_check_for_user(uuid, bigint) to service_role;
grant execute on function public.ai_usage_check_and_record_for_user(uuid, text, integer, integer) to service_role;
grant execute on function public.ai_budget_add_for_user(uuid, bigint) to service_role;
grant execute on function public.save_daily_plan_for_user(uuid, date, jsonb) to service_role;
