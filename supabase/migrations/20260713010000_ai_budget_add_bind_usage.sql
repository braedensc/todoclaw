-- Migration: ai_budget_add_bind_usage
--
-- Intent: close M2 of the 2026-07-13 BabyClaw audit — an availability (denial-of-wallet) hole in
-- the AI budget kill-switch. `ai_budget_add` is granted to `authenticated`, so any signed-in user
-- can skip the Edge Function and hit POST /rest/v1/rpc/ai_budget_add directly. The 20260706 hardening
-- clamps a single call to $0.20 and rejects negatives, but nothing limits HOW OFTEN it is called and
-- it writes the GLOBAL ai_budget_ledger. ~100 direct calls add ~$20 → the global kill-switch trips
-- and pauses AI for EVERYONE until the next UTC month. It bypasses the rate limit (that lives in
-- ai_usage_check_and_record) and the per-user sub-cap (which only gates precheck, not the add).
--
-- Fix: the ledger may only move in step with a REAL, rate-limited usage row. `ai_budget_add` now
-- takes the usage-row id returned by ai_usage_check_and_record and, under a row lock, requires that
-- row to be the caller's own and not-yet-billed; it marks it billed and then increments both ledgers.
-- Consequences:
--   • Idempotent per usage row — re-calling (or a retry) can't double-bill.
--   • You cannot inflate a ledger without a rate-limited usage row. Usage rows are bounded by the
--     hourly/daily rate limits, and once a user's per-user monthly ledger hits the $10 sub-cap,
--     precheck blocks the creation of new usage rows (ai_usage_check_and_record is never reached).
--     So a single account can add at most ~its $10 slice to the GLOBAL pool — never the whole $20 —
--     and only by actually consuming its own rate-limited calls. The standalone amplification is gone.
--   • The cost is still supplied + clamped exactly as before ($0.20 per-call ceiling, negatives
--     rejected); binding to a usage row is an ADDITIONAL gate, not a change to the cost model.
--
-- Period: the increment lands in the ledger period of the USAGE ROW (to_char(called_at at utc)), not
-- of now(). In the normal path they are the same second; this only differs for a call that spans a
-- month boundary, where billing the slot to the month it was rate-limited in is the correct behavior.
-- The security invariant this buys: the CURRENT-period ledger (the kill-switch input) can move ONLY
-- via a CURRENT-period usage row — old unbilled rows bill their own (unread) past period and can never
-- spike the live switch.
--
-- billed_at: a new nullable column on ai_usage is the idempotency flag. It is written ONLY by this
-- SECURITY DEFINER function (which runs as the table owner and so is unaffected by the narrowed
-- column-level UPDATE grant on ai_usage) — the authenticated role has no grant to write it directly.
--
-- The system/cron path (ai_budget_add_for_user, 20260707140000) is service_role-only — not reachable
-- by authenticated and therefore not a grief vector — so it is intentionally left as the p_micros form
-- (only the trusted backend can name a user). See the ADR for why it does not need the same gate.
--
-- This migration REPLACES one function and ADDS one column + its grant story; it does not touch the
-- ledgers, the rate-limit RPCs, or the RLS policies.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal — restores the 20260706 signature/behavior):
--   drop function if exists public.ai_budget_add(uuid, bigint);
--   -- Re-create the pre-M2 clamped, usage-unbound add (copy its body from
--   -- 20260706000000_ai_guardrail_rpc_hardening.sql and `create or replace` it here), then:
--   --   revoke all on function public.ai_budget_add(bigint) from public;
--   --   grant execute on function public.ai_budget_add(bigint) to authenticated;
--   alter table public.ai_usage drop column if exists billed_at;
--   -- (guardrails.ts recordUsage must also revert to calling ai_budget_add with { p_micros } only.)
-- ----------------------------------------------------------------------------

-- ============================================================================
-- Idempotency flag on the usage log
-- ----------------------------------------------------------------------------
-- Nullable → existing rows read as "unbilled", which is harmless: they are all past-period rows, and
-- ai_budget_add only bills a row into its OWN period ledger (a past period the kill-switch never
-- reads) and only once. No grant to authenticated — set exclusively by the DEFINER ai_budget_add.
-- ============================================================================

alter table public.ai_usage
  add column billed_at timestamptz;

comment on column public.ai_usage.billed_at is
  'When this request row was billed into the budget ledgers by ai_budget_add (idempotency flag; '
  'null = not yet billed). Written ONLY by the SECURITY DEFINER ai_budget_add — the authenticated '
  'role has no direct UPDATE grant on it. Binds each ledger increment to exactly one usage row so a '
  'direct RPC caller cannot inflate the kill-switch ledger (M2, 2026-07-13 audit).';

-- ============================================================================
-- ai_budget_add — now bound to a rate-limited usage row (M2)
-- ----------------------------------------------------------------------------
-- The signature changes (bigint → uuid, bigint), so the old function is DROPPED (which also drops its
-- execute grant) and the new one is created + granted. recordUsage() passes the usage id it already
-- holds from precheck. Everything else — the negative rejection and the $0.20 (200_000-micro) per-call
-- clamp — is carried over verbatim from the 20260706 hardening.
-- ============================================================================

drop function if exists public.ai_budget_add(bigint);

create function public.ai_budget_add(p_usage_id uuid, p_micros bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_row    public.ai_usage;
  v_period text;
  v_micros bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Carried over from 20260706: never let a caller REDUCE the ledger, and clamp positives to the
  -- per-call ceiling (~2.5× one legit call's max cost). A single add can move a ledger by ≤ $0.20.
  if p_micros < 0 then
    raise exception 'invalid_micros' using errcode = 'P0001';
  end if;

  -- Bind the increment to a REAL usage row owned by the caller, billed at most once. FOR UPDATE
  -- serializes concurrent calls for the same id so the billed_at check-and-set is atomic (the second
  -- caller re-reads the now-billed row and no-ops). A missing / foreign id is rejected outright — the
  -- ledger does not move without a genuine, caller-owned, rate-limited usage row behind it.
  select * into v_row from public.ai_usage where id = p_usage_id for update;
  if not found or v_row.user_id <> v_uid then
    raise exception 'usage_not_found' using errcode = 'P0001';
  end if;
  if v_row.billed_at is not null then
    return;  -- idempotent: already billed, do not double-count
  end if;

  -- Bill the slot into the period it was RATE-LIMITED in (usage row's called_at), so the current
  -- kill-switch ledger can only ever be moved by a current-period usage row.
  v_period := to_char((v_row.called_at at time zone 'utc'), 'YYYY-MM');
  v_micros := least(p_micros, 200000);

  update public.ai_usage set billed_at = now() where id = p_usage_id;

  -- Global monthly pool (the kill-switch input).
  insert into public.ai_budget_ledger (period, spent_micros)
  values (v_period, v_micros)
  on conflict (period) do update
    set spent_micros = public.ai_budget_ledger.spent_micros + excluded.spent_micros,
        updated_at = now();

  -- Per-user monthly sub-cap ledger (keyed on the JWT-derived caller, never a parameter).
  insert into public.ai_user_budget_ledger (period, user_id, spent_micros)
  values (v_period, v_uid, v_micros)
  on conflict (period, user_id) do update
    set spent_micros = public.ai_user_budget_ledger.spent_micros + excluded.spent_micros,
        updated_at = now();
end;
$$;

-- Same DEFINER lock-down as before: unreachable by public, callable by a logged-in user (whose JWT
-- supplies auth.uid()) via the Edge Function.
revoke all on function public.ai_budget_add(uuid, bigint) from public;
grant execute on function public.ai_budget_add(uuid, bigint) to authenticated;
