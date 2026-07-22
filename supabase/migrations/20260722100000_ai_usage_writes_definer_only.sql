-- Migration: ai_usage_writes_definer_only
--
-- Intent: revoke the direct INSERT/UPDATE surface on public.ai_usage — the same
-- unused-direct-grant class as task_reminders' INSERT (PR #312) and weather_cache (#310,
-- 20260722000000).
--
-- 20260624010000 granted `select, insert, update on ai_usage to authenticated` because the two
-- interactive guardrail RPCs were SECURITY INVOKER — they run table DML with the CALLER's
-- privileges, so the table grants were load-bearing for them. But the same grants are reachable
-- OUTSIDE the RPCs with the public anon key + any session JWT:
--
--   • INSERT (the hole): POST /rest/v1/ai_usage lets any signed-in user bulk-insert rows
--     directly (one PostgREST request can carry thousands), each with an UNBOUNDED `feature`
--     string — ai_usage sits outside #312's non-AI size/volume caps and `feature` has no length
--     CHECK. That is unbounded storage growth on an append-only, never-pruned log. Direct rows
--     also seed unbilled entries into the billed_at idempotency flow (20260713010000) and
--     pollute the admin usage counts. (What it does NOT allow: touching anyone else's bucket or
--     ledger — RLS pins user_id to the caller, so the rate-limit/budget side is self-grief only.)
--   • UPDATE (input_tokens, output_tokens; narrowed by 20260706000000): own-row token fudging,
--     accepted-harmless — but the grant exists ONLY to serve the INVOKER token backfill.
--
-- Fix (the #312 set_task_reminder pattern): flip BOTH RPCs to SECURITY DEFINER with the
-- RLS-equivalent fencing made explicit, then revoke the table grants and drop the insert/update
-- policies. End state: `authenticated` holds SELECT only (getStatus reads the caller's own
-- trailing-window counts through RLS); EVERY write to ai_usage goes through a SECURITY DEFINER
-- RPC — interactive ai_usage_check_and_record / ai_usage_record_tokens / ai_budget_add
-- (billed_at), system *_for_user variants (20260707140000, service_role-only). auth.uid() still
-- identifies the caller from the JWT inside DEFINER (privilege changes, identity does not).
--
-- Hardened while flipping — a DEFINER insert proxy must bound its own inputs (the ai_budget_add
-- $0.20-clamp precedent, 20260706000000):
--   • p_feature is clamped left(…, 64): a minted row can no longer carry an arbitrary payload.
--   • A fixed total-volume backstop: at 4000 request rows per user per trailing DAY (across ALL
--     features) the RPC raises 'rate_limited_total'. The per-feature limits arrive as caller
--     parameters (owner-tunable via app_config; HARD_MAX chat 2000/day + plan 50/day), so a
--     direct RPC caller could pass sky-high limits and invent fresh feature buckets — the total
--     backstop bounds row minting regardless, at ~2× the maximum configurable legitimate sum.
--     Trailing-window and self-expiring, so unlike a lifetime row cap it can never permanently
--     brick an account (the #312 rule: backstop, not quota — a legit account hitting it means
--     raising the number).
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal — restores the 20260624010000 + 20260706000000 state):
--   grant insert on public.ai_usage to authenticated;
--   grant update (input_tokens, output_tokens) on public.ai_usage to authenticated;
--   -- re-create policies ai_usage_insert_own / ai_usage_update_own and both functions as
--   -- SECURITY INVOKER (copy all four verbatim from 20260624010000_ai_usage_and_budget.sql).
-- ----------------------------------------------------------------------------

-- ============================================================================
-- ai_usage_check_and_record — INVOKER → DEFINER (+ explicit fence, feature clamp,
-- total-volume backstop). Same signature and same rate_limited_hour/day contract,
-- so callers (guardrails.ts precheck) are unchanged.
-- ============================================================================

create or replace function public.ai_usage_check_and_record(
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
  v_uid     uuid := auth.uid();
  v_feature text := left(p_feature, 64);
  v_total   integer;
  v_hour    integer;
  v_day     integer;
  v_id      uuid;
begin
  -- Explicit fence: as DEFINER this runs as the table owner (RLS no longer applies), so the
  -- caller-identity scoping the INVOKER version got from RLS is asserted here instead.
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Fixed anti-abuse backstop, NOT owner-tunable: total rows per user per trailing day across
  -- ALL features. Bounds direct-RPC row minting even with huge p_*_limit values or invented
  -- feature buckets. 4000 ≈ 2× the app_config HARD_MAX legitimate sum (chat 2000 + plan 50).
  select count(*) into v_total
    from public.ai_usage
    where user_id = v_uid
      and called_at > now() - interval '1 day';
  if v_total >= 4000 then
    raise exception 'rate_limited_total' using errcode = 'P0001';
  end if;

  select count(*) into v_hour
    from public.ai_usage
    where user_id = v_uid
      and feature = v_feature
      and called_at > now() - interval '1 hour';
  if v_hour >= p_hour_limit then
    raise exception 'rate_limited_hour' using errcode = 'P0001';
  end if;

  select count(*) into v_day
    from public.ai_usage
    where user_id = v_uid
      and feature = v_feature
      and called_at > now() - interval '1 day';
  if v_day >= p_day_limit then
    raise exception 'rate_limited_day' using errcode = 'P0001';
  end if;

  insert into public.ai_usage (user_id, feature) values (v_uid, v_feature)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ai_usage_check_and_record(text, integer, integer) from public;
grant execute on function public.ai_usage_check_and_record(text, integer, integer) to authenticated;

-- ============================================================================
-- ai_usage_record_tokens — INVOKER → DEFINER. The own-row fence (user_id = auth.uid()) was
-- already explicit in the WHERE; only the privilege source changes. Still writes exactly the
-- two token columns (billed_at stays writable ONLY by ai_budget_add).
-- ============================================================================

create or replace function public.ai_usage_record_tokens(
  p_id     uuid,
  p_input  integer,
  p_output integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  update public.ai_usage
    set input_tokens = p_input, output_tokens = p_output
    where id = p_id and user_id = auth.uid();
end;
$$;

revoke all on function public.ai_usage_record_tokens(uuid, integer, integer) from public;
grant execute on function public.ai_usage_record_tokens(uuid, integer, integer) to authenticated;

-- ============================================================================
-- Revoke the direct-write surface. SELECT (+ ai_usage_select_own) stays — getStatus reads the
-- caller's own trailing-window counts over REST, and RLS scopes it to own rows.
-- ============================================================================

revoke insert on public.ai_usage from authenticated;
revoke update (input_tokens, output_tokens) on public.ai_usage from authenticated;

drop policy "ai_usage_insert_own" on public.ai_usage;
drop policy "ai_usage_update_own" on public.ai_usage;

comment on table public.ai_usage is
  'Per-user, append-only AI request log. Rate limiting counts the owner''s rows in a trailing '
  'window per feature. token columns are observability only — the budget kill-switch uses the '
  'global ai_budget_ledger, not these. Written ONLY by the SECURITY DEFINER guardrail RPCs '
  '(ai_usage_check_and_record / ai_usage_record_tokens / ai_budget_add and the service_role '
  '*_for_user variants); authenticated holds SELECT on own rows only (20260722100000).';
