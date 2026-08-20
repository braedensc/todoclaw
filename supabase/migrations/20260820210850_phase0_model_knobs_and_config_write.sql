-- Migration: phase0_model_knobs_and_config_write
--
-- Intent: phase-0 cost scaling ("stabilize the wallet"), PR 1 — carries ALL phase-0 schema so the
-- follow-up cap-scaling and prompt-caching PRs stay migration-free / independent. Four concerns:
--
--   (1) app_config gains the MODEL KNOBS (chat_model / plan_model) + the scaled-budget BASE
--       (ai_budget_base_micros). Per-feature CHECK allowlists: chat may run haiku/sonnet only —
--       a worst-case chat call (~60k input tokens) on Opus would breach the fixed $0.20 per-call
--       clamp; the plan path is small (worst case ≈ $0.10 on Opus), so plan may also run opus.
--       Defaults stay claude-sonnet-5 ⇒ deploying this changes NO model behavior.
--   (2) Re-seed the global kill-switch ceiling $20 → $60 (guarded: only when the stored value is
--       still the old $20 default, so an owner-customized value is never clobbered) and raise the
--       column default to match. THIS is the one deliberate behavior change in PR 1: the follow-up
--       cap-scaling PR computes effectiveCap = min(base + $10 × activeUsers, ceiling, $100), and a
--       $20 ceiling would clamp the scaled value to today's cap, making scaling inert.
--   (3) app_config_set — the WRITE path the admin panel has been missing (the 20260707160000
--       header promised it as a follow-up). SECURITY DEFINER, service_role ONLY, mint_invite
--       pattern: service_role holds NO table DML in this project, so a fenced DEFINER RPC is the
--       only possible write path, and the caller id arrives as a parameter because there is no
--       auth.uid() under service_role (the admin Edge Function verifies OWNER_USER_ID first).
--       Patch semantics + least/greatest clamps to the SAME ceilings as the table CHECKs (clamp
--       layer 2 of 4: table CHECK → this RPC → edge-fn Zod → loadConfig read-clamp). Every write
--       appends an app_config_audit row (old row + new row as jsonb).
--   (4) ai_active_user_count — a COUNT (no PII) of this month's distinct AI spenders, read by the
--       follow-up cap-scaling PR at precheck time under the caller's JWT, hence granted to
--       authenticated (reviewed entry in scripts/check-definer-grants.mjs: read-only, aggregate
--       count only, no per-user data).
--
-- app_config_get is recreated to carry the three new keys (camelCase, matching its existing
-- contract with _shared/guardrails-config.ts parseConfig — which treats them as OPTIONAL, so the
-- functions auto-deploy racing this migration is safe in both orders).
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.ai_active_user_count(text);
--   drop function if exists public.app_config_set(uuid, jsonb);
--   drop table if exists public.app_config_audit;
--   -- recreate app_config_get from 20260707160000 (without the three new keys);
--   alter table public.app_config alter column global_budget_cap_micros set default 20000000;
--   update public.app_config set global_budget_cap_micros = 20000000
--     where id = 1 and global_budget_cap_micros = 60000000;
--   alter table public.app_config
--     drop column if exists chat_model,
--     drop column if exists plan_model,
--     drop column if exists ai_budget_base_micros;
-- ----------------------------------------------------------------------------

-- ============================================================================
-- (1) Model knobs + scaled-budget base on app_config
-- ============================================================================

alter table public.app_config
  add column chat_model text not null default 'claude-sonnet-5'
    check (chat_model in ('claude-haiku-4-5', 'claude-sonnet-5')),
  add column plan_model text not null default 'claude-sonnet-5'
    check (plan_model in ('claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5')),
  -- Base of the scaled monthly budget (effective cap = min(base + perUserCap × activeUsers,
  -- global ceiling, $100 HARD_MAX)). Stored now; the enforcement lands in the follow-up PR.
  add column ai_budget_base_micros bigint not null default 10000000
    check (ai_budget_base_micros between 0 and 100000000);

comment on column public.app_config.chat_model is
  'Anthropic model id for BabyClaw chat. Allowlisted by CHECK (haiku/sonnet only — a worst-case '
  'chat call on Opus would breach the fixed $0.20 per-call clamp). Mirror: ALLOWED_CHAT_MODELS in '
  '_shared/guardrails-constants.ts.';
comment on column public.app_config.plan_model is
  'Anthropic model id for Plan My Day / recap (the dispatch batch shares it). Allowlisted by CHECK '
  '(haiku/sonnet/opus — the plan path''s worst case ≈ $0.10 on Opus, inside the $0.20 clamp). '
  'Mirror: ALLOWED_PLAN_MODELS in _shared/guardrails-constants.ts.';
comment on column public.app_config.ai_budget_base_micros is
  'Base of the scaled monthly budget in micro-dollars (effective cap = min(base + perUserCap × '
  'activeUsers, global ceiling, $100)). Enforcement lands in the cap-scaling follow-up PR.';

-- ============================================================================
-- (2) Kill-switch ceiling re-seed: $20 → $60 (guarded) + new column default
-- ============================================================================

-- Only when the stored value is still the old seeded default — an owner-customized ceiling is
-- never clobbered. With cap scaling, global_budget_cap_micros becomes the manual CEILING of the
-- scaled cap rather than the whole budget; $20 would clamp scaling into a no-op.
update public.app_config
  set global_budget_cap_micros = 60000000
  where id = 1 and global_budget_cap_micros = 20000000;

alter table public.app_config alter column global_budget_cap_micros set default 60000000;

-- ============================================================================
-- (3) app_config_audit + app_config_set (the write path)
-- ============================================================================

-- Append-only audit of every config write. RLS on, NO policies, NO grants: the only writer is
-- app_config_set (DEFINER, below) and the only reader is a future owner-only surface. No
-- user-facing write grant ⇒ out of scope for the volume-bound guard (check-write-caps.mjs).
create table public.app_config_audit (
  id         bigserial primary key,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  old_config jsonb,
  new_config jsonb
);

comment on table public.app_config_audit is
  'Append-only log of app_config writes (old row + new row as jsonb, plus the owner-verified '
  'caller id). Written ONLY from app_config_set; no client grants, RLS on with no policies.';

alter table public.app_config_audit enable row level security;
-- Belt-and-braces: strip any latent default privileges from client roles (cf. #316). service_role
-- keeps no DML either — the DEFINER function below runs as the table owner.
revoke all on table public.app_config_audit from anon, authenticated;
revoke all on sequence public.app_config_audit_id_seq from anon, authenticated;

-- Patch-update the singleton config row. p_config carries ONLY the keys to change, in the same
-- camelCase vocabulary app_config_get returns. Numeric knobs are least/greatest-clamped to the
-- SAME ceilings as the table CHECK constraints (so a wild value degrades to the rail instead of
-- erroring); model strings are validated against the same allowlists as their CHECKs (raise —
-- there is no sensible clamp for an enum); the user ≤ global cross-check is kept valid by
-- clamping the per-user cap down to the (new) global cap. Returns the fresh app_config_get()
-- payload. service_role ONLY (mint_invite pattern): reached solely through the admin Edge
-- Function's admin client AFTER its isOwner() gate, which passes the verified caller as
-- p_updated_by (no auth.uid() under service_role).
create or replace function public.app_config_set(p_updated_by uuid, p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.app_config%rowtype;
  v_new public.app_config%rowtype;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'invalid_config_patch';
  end if;

  select * into v_old from public.app_config where id = 1 for update;
  if not found then
    raise exception 'app_config_missing';
  end if;
  v_new := v_old;

  -- Numeric knobs: apply only the keys present, clamped to the table-CHECK ceilings.
  if p_config ? 'globalBudgetCapMicros' then
    v_new.global_budget_cap_micros :=
      least(greatest((p_config->>'globalBudgetCapMicros')::bigint, 0), 100000000);
  end if;
  if p_config ? 'userBudgetCapMicros' then
    v_new.user_budget_cap_micros :=
      least(greatest((p_config->>'userBudgetCapMicros')::bigint, 0), 50000000);
  end if;
  if p_config ? 'aiBudgetBaseMicros' then
    v_new.ai_budget_base_micros :=
      least(greatest((p_config->>'aiBudgetBaseMicros')::bigint, 0), 100000000);
  end if;
  if p_config ? 'chatHourLimit' then
    v_new.chat_hour_limit := least(greatest((p_config->>'chatHourLimit')::integer, 0), 200);
  end if;
  if p_config ? 'chatDayLimit' then
    v_new.chat_day_limit := least(greatest((p_config->>'chatDayLimit')::integer, 0), 2000);
  end if;
  if p_config ? 'planHourLimit' then
    v_new.plan_hour_limit := least(greatest((p_config->>'planHourLimit')::integer, 0), 50);
  end if;
  if p_config ? 'planDayLimit' then
    v_new.plan_day_limit := least(greatest((p_config->>'planDayLimit')::integer, 0), 50);
  end if;

  -- Model knobs: same allowlists as the column CHECKs. An enum has no clamp — reject.
  if p_config ? 'chatModel' then
    if p_config->>'chatModel' not in ('claude-haiku-4-5', 'claude-sonnet-5') then
      raise exception 'invalid_chat_model';
    end if;
    v_new.chat_model := p_config->>'chatModel';
  end if;
  if p_config ? 'planModel' then
    if p_config->>'planModel' not in ('claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5') then
      raise exception 'invalid_plan_model';
    end if;
    v_new.plan_model := p_config->>'planModel';
  end if;

  -- Keep the user ≤ global cross-check valid whatever combination the patch produced.
  v_new.user_budget_cap_micros :=
    least(v_new.user_budget_cap_micros, v_new.global_budget_cap_micros);

  v_new.updated_at := now();
  v_new.updated_by := p_updated_by;

  update public.app_config set
    global_budget_cap_micros = v_new.global_budget_cap_micros,
    user_budget_cap_micros   = v_new.user_budget_cap_micros,
    ai_budget_base_micros    = v_new.ai_budget_base_micros,
    chat_hour_limit          = v_new.chat_hour_limit,
    chat_day_limit           = v_new.chat_day_limit,
    plan_hour_limit          = v_new.plan_hour_limit,
    plan_day_limit           = v_new.plan_day_limit,
    chat_model               = v_new.chat_model,
    plan_model               = v_new.plan_model,
    updated_at               = v_new.updated_at,
    updated_by               = v_new.updated_by
  where id = 1;

  insert into public.app_config_audit (changed_by, old_config, new_config)
  values (p_updated_by, to_jsonb(v_old), to_jsonb(v_new));

  return public.app_config_get();
end;
$$;

revoke all on function public.app_config_set(uuid, jsonb) from public;
grant execute on function public.app_config_set(uuid, jsonb) to service_role;

-- ============================================================================
-- (4) ai_active_user_count — active-spender count for the scaled cap
-- ============================================================================

-- COUNT ONLY — no ids, no emails, no amounts. "Active" = has a per-user budget ledger row this
-- period (a row is only ever created by a real recorded AI call). Read at precheck time under the
-- caller's JWT by the cap-scaling follow-up, hence the authenticated grant (reviewed in
-- scripts/check-definer-grants.mjs — read-only aggregate).
create or replace function public.ai_active_user_count(
  p_period text default to_char((now() at time zone 'utc'), 'YYYY-MM')
)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer from public.ai_user_budget_ledger where period = p_period;
$$;

revoke all on function public.ai_active_user_count(text) from public;
grant execute on function public.ai_active_user_count(text) to authenticated, service_role;

-- ============================================================================
-- app_config_get — extend with the three new keys (camelCase, same contract)
-- ============================================================================

create or replace function public.app_config_get()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'globalBudgetCapMicros', global_budget_cap_micros,
    'userBudgetCapMicros',   user_budget_cap_micros,
    'aiBudgetBaseMicros',    ai_budget_base_micros,
    'chatHourLimit',         chat_hour_limit,
    'chatDayLimit',          chat_day_limit,
    'planHourLimit',         plan_hour_limit,
    'planDayLimit',          plan_day_limit,
    'chatModel',             chat_model,
    'planModel',             plan_model,
    'updatedAt',             updated_at,
    'updatedBy',             updated_by
  )
  from public.app_config where id = 1;
$$;
