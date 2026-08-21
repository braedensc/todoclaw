-- Migration: prompt_cache_token_accounting
--
-- Intent: extend the ai_usage observability row + its token-backfill RPC with Anthropic prompt-cache
-- token counts, so the spend ledger can price cached calls correctly (phase 0 cost scaling, PR 3).
--
-- WHY THIS SHIPS WITH (not after) cache_control placement: once a request carries cache_control,
-- Anthropic's `usage.input_tokens` becomes the UNCACHED REMAINDER only — cache writes are billed
-- separately at 1.25× the input rate and cache reads at 0.1×. A ledger that kept pricing
-- input_tokens alone would silently under-count every cached call, and the budget kill-switch
-- (ai_budget_add / ai_budget_add_for_user) would trip late. costMicros (guardrails.ts) gains the
-- two cache terms in the same PR; this migration gives the counts a durable home + write path.
--
--   • Two new integer columns on ai_usage (default 0 — every historical row accurately reads
--     "no cache activity", and the check-and-record INSERT needs no change).
--   • ai_usage_record_tokens widens to (uuid, integer, integer, integer, integer). Recreated from
--     the LATEST definition (20260722170000_ai_usage_writes_definer_only.sql — SECURITY DEFINER,
--     own-row fence `where id = p_id and user_id = auth.uid()`; #314). The old 3-arg overload is
--     DROPPED explicitly so PostgREST name-based dispatch stays unambiguous and the function name
--     keeps exactly one definition (the DEFINER-grant allowlist is keyed by name).
--
-- Like the existing token columns, the cache counts are OBSERVABILITY — the budget kill-switch
-- reads the ledgers, which are advanced by ai_budget_add with the clamped micro cost. A user
-- fudging their own row's counts (the accepted-harmless shape from 20260722170000) still cannot
-- move any ledger.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal — restores the 20260722170000 state):
--   alter table public.ai_usage
--     drop column cache_creation_input_tokens,
--     drop column cache_read_input_tokens;
--   drop function public.ai_usage_record_tokens(uuid, integer, integer, integer, integer);
--   -- re-create the 3-arg ai_usage_record_tokens verbatim from 20260722170000 (DEFINER + grant).
-- ----------------------------------------------------------------------------

alter table public.ai_usage
  add column cache_creation_input_tokens integer not null default 0,
  add column cache_read_input_tokens integer not null default 0;

-- Replace, don't overload: PostgREST RPC dispatch by name must resolve to exactly one function,
-- and the reviewed DEFINER-grant allowlist entry (scripts/check-definer-grants.mjs) is per-name.
drop function public.ai_usage_record_tokens(uuid, integer, integer);

create function public.ai_usage_record_tokens(
  p_id             uuid,
  p_input          integer,
  p_output         integer,
  p_cache_creation integer,
  p_cache_read     integer
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
    set input_tokens                = p_input,
        output_tokens               = p_output,
        cache_creation_input_tokens = coalesce(p_cache_creation, 0),
        cache_read_input_tokens     = coalesce(p_cache_read, 0)
    where id = p_id and user_id = auth.uid();
end;
$$;

revoke all on function public.ai_usage_record_tokens(uuid, integer, integer, integer, integer)
  from public;
grant execute on function public.ai_usage_record_tokens(uuid, integer, integer, integer, integer)
  to authenticated;

comment on function public.ai_usage_record_tokens(uuid, integer, integer, integer, integer) is
  'Backfills a caller-owned ai_usage row with the call''s token counts (input/output + prompt-cache '
  'creation/read). Observability only — the budget ledgers move via ai_budget_add. SECURITY DEFINER '
  'with the own-row fence (id = p_id AND user_id = auth.uid()); 20260820215424 widened the '
  'signature for prompt caching and dropped the 3-arg overload.';
