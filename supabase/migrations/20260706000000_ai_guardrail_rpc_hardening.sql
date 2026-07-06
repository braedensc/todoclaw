-- Migration: ai_guardrail_rpc_hardening
--
-- Intent: harden the AI cost guardrails against DIRECT PostgREST access. The guardrail RPCs and
-- tables from 20260624010000_ai_usage_and_budget.sql are reachable by any authenticated user with
-- the public anon key (already in the frontend bundle) — i.e. OUTSIDE the Edge Functions that were
-- meant to be the only callers. A 2026-07-06 security audit found three ways to defeat the
-- $20/month kill-switch and the per-user rate limits by calling the RPCs / PATCHing the table
-- directly. This migration closes all three. It only REPLACES functions and RE-GRANTS privileges
-- on the existing tables — it does NOT edit or drop them; the one new object is the per-user
-- budget ledger (Issue 3). The no-service-role design (ADR-0015) is preserved: everything still
-- runs under the caller's JWT via SECURITY DEFINER functions, never an admin client.
--
-- ISSUE 1 (HIGH) — ai_budget_add(p_micros) did NO bounds check. A caller could pass a negative
--   p_micros to drive the global ledger negative (ai_budget_check then returns a large positive →
--   the kill-switch NEVER trips → the owner's Anthropic spend is effectively uncapped), or a huge
--   positive to trip it and disable AI for EVERYONE for the rest of the month (repeatable DoS).
--   Fix: reject negatives outright and clamp positives to a per-call ceiling comfortably above one
--   legitimate call's max cost. A legit call costs ≈ input*3 + 2048*15 micros; chat input is capped
--   at ~60k chars (ai-chat MAX_TOTAL_CHARS), so a real call is at most ~$0.08 (≤ ~210k micros even
--   in the absurd 1-char-per-token worst case). A 200_000-micro ($0.20) ceiling never bites a real
--   call yet caps what a single direct RPC can add.
--
-- ISSUE 2 (MEDIUM) — ai_usage had a TABLE-WIDE update grant to authenticated. The intent was only
--   the post-call token backfill (ai_usage_record_tokens writes input_tokens/output_tokens), but a
--   table-wide grant let a user PATCH /rest/v1/ai_usage?id=eq.<theirRow> to rewrite called_at,
--   sliding their request rows out of the trailing-window COUNT(*) in ai_usage_check_and_record and
--   resetting their own rate limit at will. Fix: narrow the grant to just those two columns. The
--   SECURITY INVOKER backfill (which updates only those columns) keeps working; called_at/feature
--   become un-writable by the app roles.
--
-- ISSUE 3 (MEDIUM, design) — the $20/month budget is a single GLOBAL pool, so even after Issues
--   1–2 one heavy account can drain it and pause AI for everyone (denial-of-wallet on availability).
--   The rate limits alone do NOT prevent this: chat 100/day + plan 10/day = 110 calls/day, which at
--   the per-call ceiling far exceeds $20 in a single day. Decision: add a PER-USER monthly sub-cap
--   (option (a) from the audit) — a second SECURITY DEFINER ledger keyed on (period, user_id),
--   checked in precheck before the rate limit — so no single account can consume the whole shared
--   pool. The sub-cap value lives in guardrails.ts (USER_BUDGET_CAP_MICROS, currently $10 = half the
--   global pool) and is tunable without a schema change. Chosen over option (b) (accept + document)
--   because the fix is low-effort (mirrors the existing global-ledger pattern) and directly removes
--   the availability risk for the invite-only MVP.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal — restores the 20260624010000 behavior):
--   -- Issue 3: drop the per-user sub-cap.
--   drop function if exists public.ai_user_budget_check(bigint);
--   drop table if exists public.ai_user_budget_ledger;
--   -- Issue 1 + 3: restore the original unbounded, single-ledger add (copy its body from
--   -- 20260624010000_ai_usage_and_budget.sql and `create or replace` it here).
--   -- Issue 2: widen the token-backfill grant back to the whole table.
--   revoke update (input_tokens, output_tokens) on public.ai_usage from authenticated;
--   grant select, insert, update on public.ai_usage to authenticated;
--   -- (guardrails.ts must also be reverted: drop the ai_user_budget_check call in precheck/getStatus
--   --  and the USER_BUDGET_CAP_MICROS constant.)
-- ----------------------------------------------------------------------------

-- ============================================================================
-- ISSUE 3 (part 1): per-user monthly spend ledger
-- ----------------------------------------------------------------------------
-- Same locked-down pattern as ai_budget_ledger: RLS ON with NO grants and NO policies, so it is
-- invisible to anon/authenticated and reachable ONLY through the SECURITY DEFINER functions
-- (ai_budget_add writes it; ai_user_budget_check reads it). Keyed on (period, user_id); a new month
-- is simply a new PK row (cron-free reset, the daily_state philosophy — ADR-0007). Must exist
-- before ai_budget_add is (re)defined below, which references it.
-- ============================================================================

create table public.ai_user_budget_ledger (
  period       text not null,                                   -- 'YYYY-MM' (UTC)
  user_id      uuid not null references auth.users (id) on delete cascade,
  spent_micros bigint not null default 0,                       -- accumulated spend, millionths of a USD
  updated_at   timestamptz not null default now(),
  primary key (period, user_id)
);

comment on table public.ai_user_budget_ledger is
  'Per-user monthly AI spend (micro-dollars) behind the per-user budget sub-cap (Issue 3, '
  '2026-07-06 audit). RLS on with NO grants/policies → invisible to app roles; written by '
  'ai_budget_add and read by ai_user_budget_check (both SECURITY DEFINER). Cron-free monthly '
  'reset (a new period = a new row). Bounds any single account to its slice of the global pool.';

alter table public.ai_user_budget_ledger enable row level security;
-- Intentionally NO grants and NO policies: unreachable by anon/authenticated (like ai_budget_ledger).

-- ============================================================================
-- ISSUE 1 (+ ISSUE 3 part 2): bounded budget increment that writes BOTH ledgers
-- ----------------------------------------------------------------------------
-- Replaces the original unbounded add. Same signature ai_budget_add(bigint) → its existing execute
-- grant to authenticated is preserved across the replace (re-asserted below for clarity). Now (1)
-- rejects negatives and clamps positives to the per-call ceiling (Issue 1), and (2) also increments
-- the caller's per-user ledger row (Issue 3) so both the global pool and the personal sub-cap
-- advance in the same call — recordUsage still makes just one RPC.
-- ============================================================================

create or replace function public.ai_budget_add(p_micros bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := to_char((now() at time zone 'utc'), 'YYYY-MM');
  v_uid    uuid := auth.uid();
  v_micros bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- ISSUE 1: never let a caller REDUCE the ledger (a negative would uncap the kill-switch), and
  -- clamp positives to a per-call ceiling far above one legit call's max cost (~$0.08; see the
  -- header note). A single direct RPC can therefore add at most 200_000 micros ($0.20).
  if p_micros < 0 then
    raise exception 'invalid_micros' using errcode = 'P0001';
  end if;
  v_micros := least(p_micros, 200000);

  -- Global monthly pool (the kill-switch input).
  insert into public.ai_budget_ledger (period, spent_micros)
  values (v_period, v_micros)
  on conflict (period) do update
    set spent_micros = public.ai_budget_ledger.spent_micros + excluded.spent_micros,
        updated_at = now();

  -- ISSUE 3: per-user monthly sub-cap ledger (keyed on the JWT-derived caller, never a parameter).
  insert into public.ai_user_budget_ledger (period, user_id, spent_micros)
  values (v_period, v_uid, v_micros)
  on conflict (period, user_id) do update
    set spent_micros = public.ai_user_budget_ledger.spent_micros + excluded.spent_micros,
        updated_at = now();
end;
$$;

-- Re-assert the DEFINER lock-down (preserved across create-or-replace, restated for clarity).
revoke all on function public.ai_budget_add(bigint) from public;
grant execute on function public.ai_budget_add(bigint) to authenticated;

-- ============================================================================
-- ISSUE 3 (part 3): per-user budget check
-- ----------------------------------------------------------------------------
-- Mirrors ai_budget_check but scoped to auth.uid(). SECURITY DEFINER so it can read the no-grant
-- per-user ledger. Returns the caller's remaining micro-dollars for the current UTC month
-- (≤ 0 ⇒ this user is personally paused, even if the global pool still has headroom).
-- ============================================================================

create or replace function public.ai_user_budget_check(p_cap_micros bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent  bigint;
  v_period text := to_char((now() at time zone 'utc'), 'YYYY-MM');
  v_uid    uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select coalesce(spent_micros, 0) into v_spent
    from public.ai_user_budget_ledger
    where period = v_period and user_id = v_uid;
  return p_cap_micros - coalesce(v_spent, 0);
end;
$$;

revoke all on function public.ai_user_budget_check(bigint) from public;
grant execute on function public.ai_user_budget_check(bigint) to authenticated;

-- ============================================================================
-- ISSUE 2: narrow the ai_usage UPDATE grant to the two token-backfill columns
-- ----------------------------------------------------------------------------
-- Revoke the table-wide UPDATE, then grant column-level UPDATE on only input_tokens/output_tokens.
-- ai_usage_record_tokens (SECURITY INVOKER, updates exactly those two columns) keeps working; a
-- direct PATCH of called_at or feature is now rejected, so users can't slide rows out of the
-- rate-limit window. The ai_usage_update_own RLS policy is left intact (belt-and-suspenders).
-- ============================================================================

revoke update on public.ai_usage from authenticated;
grant update (input_tokens, output_tokens) on public.ai_usage to authenticated;
