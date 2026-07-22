// Guardrails — what bounds the owner's Anthropic key (ADR-0015). Two layers, both enforced
// server-side via the migration's SQL functions (20260624010000_ai_usage_and_budget.sql):
//
//   • Per-user RATE LIMITS (ai_usage_check_and_record — SECURITY DEFINER since 20260722100000,
//     which also revoked ai_usage's direct INSERT/UPDATE grants: the RPCs are the only write path).
//   • A global monthly BUDGET KILL-SWITCH in micro-dollars (ai_budget_check / ai_budget_add,
//     SECURITY DEFINER — the only path to the no-grant ai_budget_ledger; no service-role key).
//
// All calls go through the CALLER's JWT client (auth.ts), so auth.uid() inside the SQL is the
// real user and is never a parameter. The caps/limits are OWNER-TUNABLE at runtime: loadConfig()
// reads them from app_config (Admin panel), falling back to the constants below on any read failure.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { sendSpendAlert } from './spend-alert.ts'
import { loadConfig } from './guardrails-config.ts'
import {
  LIMITS,
  BUDGET_CAP_MICROS,
  USER_BUDGET_CAP_MICROS,
  PER_CALL_CEILING_MICROS,
  USER_SPEND_ALERT_MICROS,
  SPEND_ALERT_FRACTION,
  type Feature,
} from './guardrails-constants.ts'

// The primitive constants + Feature type live in guardrails-constants.ts (to break the circular
// import with guardrails-config.ts). Re-exported here so existing `from './guardrails.ts'` imports
// (callers + tests) keep working. These are the DEFAULTS / fallback; the live values come from
// app_config via loadConfig().
export {
  LIMITS,
  BUDGET_CAP_MICROS,
  USER_BUDGET_CAP_MICROS,
  PER_CALL_CEILING_MICROS,
  USER_SPEND_ALERT_MICROS,
  SPEND_ALERT_FRACTION,
  type Feature,
}

// Did this call push the user's cumulative monthly spend across the alert threshold? True ONLY on
// the single call that first crosses it (prev < threshold ≤ next), so the owner is paged once per
// user per month — not on every call after the line. Spend only increments, so this is monotonic;
// and because each add is clamped to PER_CALL_CEILING_MICROS (< the threshold), no call can leap the
// line from far below — it always steps across it, and this catches that step. The threshold defaults
// to the fallback constant but is passed the LIVE (per app_config) value by recordUsage.
export function crossedSpendAlert(
  prevMicros: number,
  nextMicros: number,
  thresholdMicros: number = USER_SPEND_ALERT_MICROS,
): boolean {
  return prevMicros < thresholdMicros && nextMicros >= thresholdMicros
}

// 'YYYY-MM' in UTC — matches the period key the SQL ledgers use (to_char(now() at time zone 'utc')).
function utcPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

// Sonnet 5 STANDARD pricing: $3 / 1M input tokens, $15 / 1M output tokens (identical to Sonnet 4.6).
// Converting to micros: micros = (input/1e6)*3*1e6 + (output/1e6)*15*1e6 = input*3 + output*15.
// Sonnet 5's INTRODUCTORY pricing ($2/$10 through 2026-08-31) is cheaper, so this formula slightly
// OVER-counts spend until then — a conservative, safe direction for the kill-switch (it can only
// trip early, never late), and it self-corrects when standard pricing kicks in. No dated code to revert.
export function costMicros(inputTokens: number, outputTokens: number): number {
  return Math.round(inputTokens * 3 + outputTokens * 15)
}

export type PrecheckResult =
  | { ok: true; usageId: string }
  | { ok: false; reason: 'budget-exhausted' | 'rate-limited'; detail?: string }

// Pre-call gate: budget kill-switches FIRST (cheap, no write — don't charge a rate-limit unit
// against an already-paused month), then the per-user rate limit (which records the request).
// Order: global monthly pool → per-user monthly sub-cap → rate limit.
export async function precheck(client: SupabaseClient, feature: Feature): Promise<PrecheckResult> {
  const cfg = await loadConfig(client)
  const { data: remaining, error: budgetErr } = await client.rpc('ai_budget_check', {
    p_cap_micros: cfg.globalBudgetCapMicros,
  })
  if (budgetErr) return { ok: false, reason: 'budget-exhausted', detail: budgetErr.message }
  if (typeof remaining === 'number' && remaining <= 0)
    return { ok: false, reason: 'budget-exhausted' }

  // Per-user monthly sub-cap: one account can't drain the shared pool (Issue 3, 2026-07-06 audit).
  const { data: userRemaining, error: userErr } = await client.rpc('ai_user_budget_check', {
    p_cap_micros: cfg.userBudgetCapMicros,
  })
  if (userErr) return { ok: false, reason: 'budget-exhausted', detail: userErr.message }
  if (typeof userRemaining === 'number' && userRemaining <= 0)
    return { ok: false, reason: 'budget-exhausted', detail: 'user-monthly-cap' }

  const limit = cfg.limits[feature]
  const { data: usageId, error: rateErr } = await client.rpc('ai_usage_check_and_record', {
    p_feature: feature,
    p_hour_limit: limit.hour,
    p_day_limit: limit.day,
  })
  // The function RAISES rate_limited_hour / rate_limited_day (errcode P0001) when over.
  if (rateErr) return { ok: false, reason: 'rate-limited', detail: rateErr.message }
  return { ok: true, usageId: usageId as string }
}

// Post-call: backfill the request row's token counts (observability) and add this call's cost to
// the month ledgers via ai_budget_add — which now advances BOTH the global pool and the caller's
// per-user sub-cap, and clamps the amount server-side (rejects negatives, caps at the per-call
// ceiling). The add is BOUND to this call's usageId (M2, 2026-07-13 audit): the ledger moves only in
// step with a real, rate-limited usage row, billed at most once — a direct RPC caller can no longer
// spam the global kill-switch. Best-effort; failures are swallowed so a guardrail-bookkeeping hiccup
// never fails the user's already-completed request.
export async function recordUsage(
  client: SupabaseClient,
  usageId: string,
  inputTokens: number,
  outputTokens: number,
  feature: Feature,
): Promise<void> {
  await client.rpc('ai_usage_record_tokens', {
    p_id: usageId,
    p_input: inputTokens,
    p_output: outputTokens,
  })
  await client.rpc('ai_budget_add', {
    p_usage_id: usageId,
    p_micros: costMicros(inputTokens, outputTokens),
  })

  // Owner spend-alert (best-effort). Read the caller's NEW monthly total, reconstruct the pre-call
  // total from what this call actually added (clamped like the SQL), and page the owner once if this
  // call is the one that crossed the alert line. Wrapped so an alerting failure never surfaces —
  // recordUsage is already best-effort at every call site, and the budget bookkeeping above is done.
  try {
    const cfg = await loadConfig(client)
    const alertMicros = Math.round(cfg.userBudgetCapMicros * SPEND_ALERT_FRACTION)
    const added = Math.min(costMicros(inputTokens, outputTokens), PER_CALL_CEILING_MICROS)
    const { data: remaining } = await client.rpc('ai_user_budget_check', {
      p_cap_micros: cfg.userBudgetCapMicros,
    })
    if (typeof remaining !== 'number') return
    const nextSpent = cfg.userBudgetCapMicros - remaining
    if (!crossedSpendAlert(nextSpent - added, nextSpent, alertMicros)) return
    // Identity is only needed on the rare crossing → fetch it lazily (not on every call).
    const { data: userData } = await client.auth.getUser()
    await sendSpendAlert({
      userId: userData.user?.id ?? 'unknown',
      userEmail: userData.user?.email ?? null,
      feature,
      spentMicros: nextSpent,
      capMicros: cfg.userBudgetCapMicros,
      thresholdMicros: alertMicros,
      period: utcPeriod(),
    })
  } catch {
    /* alerting is best-effort — never fail the user's already-completed request */
  }
}

export interface AiStatus {
  paused: boolean
  budgetRemainingMicros: number
  limits: Record<Feature, { hour: number; day: number }>
  used: Record<Feature, { hour: number; day: number }>
}

// Read-only status for the ai-status endpoint + the UI "AI paused this month" banner. Reads
// the global budget (DEFINER fn) and the caller's own trailing-window usage counts (RLS-scoped
// SELECTs on ai_usage). No request is recorded.
export async function getStatus(client: SupabaseClient): Promise<AiStatus> {
  const cfg = await loadConfig(client)
  // The caller's real headroom is the smaller of the global pool and their per-user sub-cap —
  // report/pause on whichever is tighter so the banner matches what precheck will actually enforce.
  const [globalRes, userRes] = await Promise.all([
    client.rpc('ai_budget_check', { p_cap_micros: cfg.globalBudgetCapMicros }),
    client.rpc('ai_user_budget_check', { p_cap_micros: cfg.userBudgetCapMicros }),
  ])
  const globalRemaining = typeof globalRes.data === 'number' ? globalRes.data : 0
  const userRemaining = typeof userRes.data === 'number' ? userRes.data : 0
  const budgetRemainingMicros = Math.min(globalRemaining, userRemaining)

  const sinceHour = new Date(Date.now() - 3_600_000).toISOString()
  const sinceDay = new Date(Date.now() - 86_400_000).toISOString()
  const features = Object.keys(cfg.limits) as Feature[]

  const used = {} as Record<Feature, { hour: number; day: number }>
  await Promise.all(
    features.map(async (feature) => {
      const hourRes = await client
        .from('ai_usage')
        .select('*', { count: 'exact', head: true })
        .eq('feature', feature)
        .gt('called_at', sinceHour)
      const dayRes = await client
        .from('ai_usage')
        .select('*', { count: 'exact', head: true })
        .eq('feature', feature)
        .gt('called_at', sinceDay)
      used[feature] = { hour: hourRes.count ?? 0, day: dayRes.count ?? 0 }
    }),
  )

  return { paused: budgetRemainingMicros <= 0, budgetRemainingMicros, limits: cfg.limits, used }
}
