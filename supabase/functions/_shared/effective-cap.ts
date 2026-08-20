// effective-cap.ts — the SCALED global AI budget cap (phase 0, ADR 2026-08-20 Decision 3). The
// stored global_budget_cap_micros stops being "the budget" and becomes the owner's MANUAL CEILING;
// the enforced cap grows with real adoption instead:
//
//   effectiveCap = min(base + perUserCap × activeUsers, manual ceiling, HARD_MAX.global)
//
// activeUsers = ai_active_user_count() (migration 20260820210850): a DEFINER count of this UTC
// month's distinct spenders — aggregate only, no PII — granted to authenticated + service_role, so
// the interactive precheck (user JWT), the cron dispatcher (service_role), and the admin overview
// can all read it. FAIL-SAFE: any RPC error / null / non-number degrades the count to 0 ⇒ cap =
// base — a failed read can only NARROW the cap, never widen it (never unbounded).
//
// The count is cached per isolate with the same TTL pattern as loadConfig (guardrails-config.ts:
// Edge Functions run per_worker, so a module-level cache persists across requests) — precheck does
// not add a fresh RPC round-trip on every request. A failed read is NEVER cached (the next call
// retries); a legitimate 0 (no spenders yet this month) IS a valid, cacheable count.
//
// This module also owns the GLOBAL kill-switch trip alert (roadmap G1): when the shared pool
// exhausts at the global check, the owner is paged via the same webhook as the per-user spend alert
// (spend-alert.ts), deduped once per UTC period PER ISOLATE — duplicate alerts across isolates are
// tolerable, missing alerts are not, so a failed send is not marked and the next trip retries.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { HARD_MAX, type GuardrailConfig } from './guardrails-config.ts'
import { sendGlobalBudgetAlert, type GlobalBudgetAlert } from './spend-alert.ts'

// 'YYYY-MM' in UTC — matches the period key the SQL ledgers use (to_char(now() at time zone
// 'utc')). Shared by the reader modules (guardrails.ts imports it from here).
export function utcPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

// The pure formula. A garbage count (NaN, negative, non-finite) contributes 0 — base only; a
// fractional count floors. cfg's inputs are already clamped by parseConfig / FALLBACK_CONFIG, and
// HARD_MAX.global re-clamps here anyway so no input combination can exceed $100.
export function effectiveCapMicros(cfg: GuardrailConfig, activeCount: number): number {
  const count = Number.isFinite(activeCount) && activeCount > 0 ? Math.floor(activeCount) : 0
  return Math.min(
    cfg.budgetBaseMicros + cfg.userBudgetCapMicros * count,
    cfg.globalBudgetCapMicros,
    HARD_MAX.global,
  )
}

// Same TTL as the config cache — the two reads age together, so a busy isolate sees at most one
// fresh RPC for each per 30s window.
export const COUNT_CACHE_TTL_MS = 30_000

let countCache: { value: number; expires: number } | null = null

// Test-only: clear the per-isolate count cache between cases.
export function _resetActiveCountCache(): void {
  countCache = null
}

// This UTC period's active-spender count (cached). Any failure ⇒ 0, uncached — fail-safe, retried
// on the next call. `now` is injectable for tests. The RPC defaults its period arg server-side.
export async function loadActiveUserCount(
  client: SupabaseClient,
  now: number = Date.now(),
): Promise<number> {
  if (countCache && countCache.expires > now) return countCache.value
  try {
    const { data, error } = await client.rpc('ai_active_user_count')
    if (error || typeof data !== 'number' || !Number.isFinite(data)) return 0
    const count = Math.max(0, Math.floor(data))
    countCache = { value: count, expires: now + COUNT_CACHE_TTL_MS }
    return count
  } catch {
    return 0
  }
}

export interface EffectiveCap {
  capMicros: number
  activeUserCount: number
}

// The ONE computation all three readers share (precheck / getStatus / precheckForUser) — never
// derive the cap at a call site, or one surface ends up enforcing a different budget.
export async function loadEffectiveCap(
  client: SupabaseClient,
  cfg: GuardrailConfig,
  now: number = Date.now(),
): Promise<EffectiveCap> {
  const activeUserCount = await loadActiveUserCount(client, now)
  return { capMicros: effectiveCapMicros(cfg, activeUserCount), activeUserCount }
}

// ─── global kill-switch trip alert ──────────────────────────────────────────────────────────────

const alertedPeriods = new Set<string>()

// Test-only: clear the per-isolate once-per-period dedupe.
export function _resetGlobalTripAlert(): void {
  alertedPeriods.clear()
}

// Page the owner that the GLOBAL pool tripped — at most once per UTC period per isolate. Marks the
// period only after a successful send (webhook configured AND 2xx), so an unset/failing webhook
// retries on the next trip instead of silently losing the alert. Non-throwing; callers still wrap
// it (belt and braces — an alert must never fail the caller's request).
export async function alertGlobalBudgetTrip(
  alert: GlobalBudgetAlert,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  if (alertedPeriods.has(alert.period)) return false
  try {
    const sent = await sendGlobalBudgetAlert(alert, fetchImpl)
    if (sent) alertedPeriods.add(alert.period)
    return sent
  } catch {
    return false
  }
}
