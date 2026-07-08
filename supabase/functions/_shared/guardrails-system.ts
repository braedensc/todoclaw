// guardrails-system.ts — the SYSTEM-context counterparts of guardrails.ts, for the proactive
// dispatcher (ADR-0031). Same budgets, same rate limits, same $0.20 per-call clamp — but reached
// through the service_role admin client + the *_for_user / *_system SQL RPCs (20260707140000), which
// take an explicit p_user_id because a cron has no JWT for auth.uid() to read. So proactive AI spend
// lands in the exact same $20 global / $10 per-user ledgers as interactive AI: one budget, two entry
// points. The functions are byte-for-byte the interactive precheck/recordUsage flow with auth.uid()
// swapped for a passed userId.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { costMicros, type Feature, type PrecheckResult } from './guardrails.ts'
import { loadConfig } from './guardrails-config.ts'

// Pre-call gate for a named user: global pool → per-user sub-cap → rate limit (records the request).
// Mirrors precheck() but every RPC is the service_role _for_user / _system variant. Same ordering, so
// an already-paused month is never charged a rate-limit unit.
export async function precheckForUser(
  admin: SupabaseClient,
  userId: string,
  feature: Feature,
): Promise<PrecheckResult> {
  const cfg = await loadConfig(admin)
  const { data: remaining, error: budgetErr } = await admin.rpc('ai_budget_check_system', {
    p_cap_micros: cfg.globalBudgetCapMicros,
  })
  if (budgetErr) return { ok: false, reason: 'budget-exhausted', detail: budgetErr.message }
  if (typeof remaining === 'number' && remaining <= 0)
    return { ok: false, reason: 'budget-exhausted' }

  const { data: userRemaining, error: userErr } = await admin.rpc('ai_user_budget_check_for_user', {
    p_user_id: userId,
    p_cap_micros: cfg.userBudgetCapMicros,
  })
  if (userErr) return { ok: false, reason: 'budget-exhausted', detail: userErr.message }
  if (typeof userRemaining === 'number' && userRemaining <= 0)
    return { ok: false, reason: 'budget-exhausted', detail: 'user-monthly-cap' }

  const limit = cfg.limits[feature]
  const { data: usageId, error: rateErr } = await admin.rpc('ai_usage_check_and_record_for_user', {
    p_user_id: userId,
    p_feature: feature,
    p_hour_limit: limit.hour,
    p_day_limit: limit.day,
  })
  if (rateErr) return { ok: false, reason: 'rate-limited', detail: rateErr.message }
  return { ok: true, usageId: usageId as string }
}

// Post-call: add this call's cost to BOTH ledgers for the user (the SQL clamps + rejects negatives).
// Best-effort — a bookkeeping hiccup must never fail an already-generated message. Token backfill is
// skipped for the system path (observability only; the interactive path still fills its own rows).
export async function recordUsageForUser(
  admin: SupabaseClient,
  userId: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  try {
    await admin.rpc('ai_budget_add_for_user', {
      p_user_id: userId,
      p_micros: costMicros(inputTokens, outputTokens),
    })
  } catch {
    /* best-effort: the spend is small + bounded (≤ 1 plan + 1 recap/user/day) and the per-user
       try/catch in the dispatcher logs the failure; never fail the send over bookkeeping. */
  }
}
