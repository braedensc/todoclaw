// Guardrails — what bounds the owner's Anthropic key (ADR-0015). Two layers, both enforced
// server-side via the migration's SQL functions (20260624010000_ai_usage_and_budget.sql):
//
//   • Per-user RATE LIMITS (ai_usage_check_and_record, SECURITY INVOKER).
//   • A global monthly BUDGET KILL-SWITCH in micro-dollars (ai_budget_check / ai_budget_add,
//     SECURITY DEFINER — the only path to the no-grant ai_budget_ledger; no service-role key).
//
// All calls go through the CALLER's JWT client (auth.ts), so auth.uid() inside the SQL is the
// real user and is never a parameter. Limits/cap are constants here (Balanced tier) — tunable.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'

export type Feature = 'chat' | 'plan_my_day'

// Balanced tier (chosen 2026-06-24). plan_my_day's hour==day makes it an effective daily cap.
export const LIMITS: Record<Feature, { hour: number; day: number }> = {
  chat: { hour: 30, day: 100 },
  plan_my_day: { hour: 10, day: 10 },
}

// $20.00/month, in micro-dollars (millionths of a USD).
export const BUDGET_CAP_MICROS = 20_000_000

// Per-user monthly sub-cap, $10.00 (half the global pool) — Issue 3 of the 2026-07-06 audit.
// The $20 budget is a single GLOBAL pool, so one heavy account could drain it and pause AI for
// everyone (denial-of-wallet on availability; the rate limits alone don't stop it). This sub-cap,
// enforced by ai_user_budget_check against a per-user DEFINER ledger, bounds any single account to
// its own slice so it can't consume the whole pool. Tunable here without a schema change; must stay
// below BUDGET_CAP_MICROS to mean anything (asserted in guardrails.test.ts).
export const USER_BUDGET_CAP_MICROS = 10_000_000

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
  const { data: remaining, error: budgetErr } = await client.rpc('ai_budget_check', {
    p_cap_micros: BUDGET_CAP_MICROS,
  })
  if (budgetErr) return { ok: false, reason: 'budget-exhausted', detail: budgetErr.message }
  if (typeof remaining === 'number' && remaining <= 0)
    return { ok: false, reason: 'budget-exhausted' }

  // Per-user monthly sub-cap: one account can't drain the shared pool (Issue 3, 2026-07-06 audit).
  const { data: userRemaining, error: userErr } = await client.rpc('ai_user_budget_check', {
    p_cap_micros: USER_BUDGET_CAP_MICROS,
  })
  if (userErr) return { ok: false, reason: 'budget-exhausted', detail: userErr.message }
  if (typeof userRemaining === 'number' && userRemaining <= 0)
    return { ok: false, reason: 'budget-exhausted', detail: 'user-monthly-cap' }

  const limit = LIMITS[feature]
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
// ceiling). Best-effort; failures are swallowed so a guardrail-bookkeeping hiccup never fails the
// user's already-completed request.
export async function recordUsage(
  client: SupabaseClient,
  usageId: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  await client.rpc('ai_usage_record_tokens', {
    p_id: usageId,
    p_input: inputTokens,
    p_output: outputTokens,
  })
  await client.rpc('ai_budget_add', { p_micros: costMicros(inputTokens, outputTokens) })
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
  // The caller's real headroom is the smaller of the global pool and their per-user sub-cap —
  // report/pause on whichever is tighter so the banner matches what precheck will actually enforce.
  const [globalRes, userRes] = await Promise.all([
    client.rpc('ai_budget_check', { p_cap_micros: BUDGET_CAP_MICROS }),
    client.rpc('ai_user_budget_check', { p_cap_micros: USER_BUDGET_CAP_MICROS }),
  ])
  const globalRemaining = typeof globalRes.data === 'number' ? globalRes.data : 0
  const userRemaining = typeof userRes.data === 'number' ? userRes.data : 0
  const budgetRemainingMicros = Math.min(globalRemaining, userRemaining)

  const sinceHour = new Date(Date.now() - 3_600_000).toISOString()
  const sinceDay = new Date(Date.now() - 86_400_000).toISOString()
  const features = Object.keys(LIMITS) as Feature[]

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

  return { paused: budgetRemainingMicros <= 0, budgetRemainingMicros, limits: LIMITS, used }
}
