// guardrails-config.ts — loads the OWNER-tunable guardrail knobs (budget caps + rate limits +
// per-feature MODELS, 2026-08-20) from the app_config table (20260707160000, extended by
// 20260820210850) so they are editable at runtime, with a HARD FALLBACK to the compile-time
// constants in guardrails.ts so AI NEVER breaks on a config read failure. The models are
// ALLOWLISTED knobs (ALLOWED_CHAT_MODELS / ALLOWED_PLAN_MODELS — chat never runs Opus, so the
// per-call clamp holds); the per-call $0.20 clamp itself (guardrails.ts / ai_budget_add SQL)
// remains a fixed safety rail, never editable.
//
// Reading app_config on every AI call would add a round-trip, so a per-isolate cache (Edge Functions
// run `per_worker`, so a module-level cache persists across requests) memoizes the value for
// CACHE_TTL_MS — precheck + recordUsage in one request share a single read. A failed or malformed
// read is NEVER cached (the next call retries): caching a bad read could pause AI for everyone (a
// stuck cap of 0) or uncap it (a stuck huge value). A legitimately-stored 0 cap IS honored — that is
// an intentional owner kill-switch, distinct from "read failed".

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import {
  LIMITS,
  BUDGET_CAP_MICROS,
  USER_BUDGET_CAP_MICROS,
  AI_BUDGET_BASE_MICROS,
  ALLOWED_CHAT_MODELS,
  ALLOWED_PLAN_MODELS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_PLAN_MODEL,
  type Feature,
} from './guardrails-constants.ts'

export interface GuardrailConfig {
  globalBudgetCapMicros: number
  userBudgetCapMicros: number
  budgetBaseMicros: number
  chatModel: string
  planModel: string
  limits: Record<Feature, { hour: number; day: number }>
}

// Hard ceilings — the LAST clamp layer (read side). MUST mirror the CHECK constraints in
// 20260707160000_app_config_and_admin_reads.sql + 20260820210850 (base). Keep them in sync.
export const HARD_MAX = {
  global: 100_000_000, // $100
  user: 50_000_000, // $50
  base: 100_000_000, // $100 (scaled-budget base)
  chatHour: 200,
  chatDay: 2000,
  planHour: 50,
  planDay: 50,
} as const

// Defaults == the guardrails.ts constants. Returned whenever app_config can't be read/parsed, so a
// config outage is behavior-identical to today. (Assert HARD_MAX ≥ defaults in tests.)
export const FALLBACK_CONFIG: GuardrailConfig = {
  globalBudgetCapMicros: BUDGET_CAP_MICROS,
  userBudgetCapMicros: USER_BUDGET_CAP_MICROS,
  budgetBaseMicros: AI_BUDGET_BASE_MICROS,
  chatModel: DEFAULT_CHAT_MODEL,
  planModel: DEFAULT_PLAN_MODEL,
  limits: LIMITS,
}

export const CACHE_TTL_MS = 30_000

const clampInt = (n: number, max: number) => Math.max(0, Math.min(Math.round(n), max))

// Turn a raw app_config_get() payload into a clamped GuardrailConfig, or null if it is
// missing/malformed (→ the caller falls back to the constants). Exported for tests. A stored 0 is a
// valid value (kept), not treated as "missing".
//
// The 2026-08-20 keys (chatModel / planModel / aiBudgetBaseMicros) are OPTIONAL — absent ⇒ their
// defaults; present but invalid (wrong type, or a model outside its allowlist) ⇒ THAT key's
// default, the rest of the config intact. They must never be required: edge functions auto-deploy
// on merge, so a new function build can read a PRE-migration app_config row — a required key would
// collapse the whole (otherwise valid) config to FALLBACK_CONFIG and wipe the owner's tuned caps.
export function parseConfig(raw: unknown): GuardrailConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const keys = [
    'globalBudgetCapMicros',
    'userBudgetCapMicros',
    'chatHourLimit',
    'chatDayLimit',
    'planHourLimit',
    'planDayLimit',
  ] as const
  for (const k of keys) {
    if (typeof r[k] !== 'number' || !Number.isFinite(r[k] as number)) return null
  }
  const model = (v: unknown, allowed: readonly string[], fallback: string): string =>
    typeof v === 'string' && allowed.includes(v) ? v : fallback
  const base =
    typeof r.aiBudgetBaseMicros === 'number' && Number.isFinite(r.aiBudgetBaseMicros)
      ? clampInt(r.aiBudgetBaseMicros, HARD_MAX.base)
      : AI_BUDGET_BASE_MICROS
  return {
    globalBudgetCapMicros: clampInt(r.globalBudgetCapMicros as number, HARD_MAX.global),
    userBudgetCapMicros: clampInt(r.userBudgetCapMicros as number, HARD_MAX.user),
    budgetBaseMicros: base,
    chatModel: model(r.chatModel, ALLOWED_CHAT_MODELS, DEFAULT_CHAT_MODEL),
    planModel: model(r.planModel, ALLOWED_PLAN_MODELS, DEFAULT_PLAN_MODEL),
    limits: {
      chat: {
        hour: clampInt(r.chatHourLimit as number, HARD_MAX.chatHour),
        day: clampInt(r.chatDayLimit as number, HARD_MAX.chatDay),
      },
      plan_my_day: {
        hour: clampInt(r.planHourLimit as number, HARD_MAX.planHour),
        day: clampInt(r.planDayLimit as number, HARD_MAX.planDay),
      },
    },
  }
}

let cache: { value: GuardrailConfig; expires: number } | null = null

// Test-only: clear the per-isolate cache between cases.
export function _resetConfigCache(): void {
  cache = null
}

// Load the live guardrail config (cached). Any read failure → FALLBACK_CONFIG, uncached. `now` is
// injectable for tests.
export async function loadConfig(
  client: SupabaseClient,
  now: number = Date.now(),
): Promise<GuardrailConfig> {
  if (cache && cache.expires > now) return cache.value
  try {
    const { data, error } = await client.rpc('app_config_get')
    if (error) return FALLBACK_CONFIG
    const parsed = parseConfig(data)
    if (!parsed) return FALLBACK_CONFIG
    cache = { value: parsed, expires: now + CACHE_TTL_MS }
    return parsed
  } catch {
    return FALLBACK_CONFIG
  }
}
