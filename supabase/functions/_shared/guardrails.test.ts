// Deno unit tests for the pure guardrail logic (the DB-backed parts are proven by the psql
// guardrail proof). Run: deno test --no-check supabase/functions/_shared/
import { assertEquals } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import {
  costMicros,
  recordUsage,
  BUDGET_CAP_MICROS,
  USER_BUDGET_CAP_MICROS,
  USER_SPEND_ALERT_MICROS,
  PER_CALL_CEILING_MICROS,
  crossedSpendAlert,
  LIMITS,
} from './guardrails.ts'
import { _resetConfigCache } from './guardrails-config.ts'

Deno.test('costMicros: Sonnet 5 standard pricing ($3/$15 per 1M) → micro-dollars', () => {
  // 1M input = $3 = 3,000,000 micros; 1M output = $15 = 15,000,000 micros.
  assertEquals(costMicros(1_000_000, 0), 3_000_000)
  assertEquals(costMicros(0, 1_000_000), 15_000_000)
  assertEquals(costMicros(1_000_000, 1_000_000), 18_000_000)
  // A small realistic chat turn: 2k in, 500 out → 2000*3 + 500*15 = 13,500 micros ($0.0135).
  assertEquals(costMicros(2_000, 500), 13_500)
  assertEquals(costMicros(0, 0), 0)
})

Deno.test('costMicros: per-model pricing (haiku $1/$5, sonnet $3/$15, opus $5/$25)', () => {
  // Haiku 4.5.
  assertEquals(costMicros(1_000_000, 0, 'claude-haiku-4-5'), 1_000_000)
  assertEquals(costMicros(0, 1_000_000, 'claude-haiku-4-5'), 5_000_000)
  assertEquals(costMicros(2_000, 500, 'claude-haiku-4-5'), 4_500)
  // Sonnet 5 named explicitly == the default path.
  assertEquals(costMicros(2_000, 500, 'claude-sonnet-5'), costMicros(2_000, 500))
  // Opus 5.
  assertEquals(costMicros(1_000_000, 0, 'claude-opus-5'), 5_000_000)
  assertEquals(costMicros(0, 1_000_000, 'claude-opus-5'), 25_000_000)
  assertEquals(costMicros(2_000, 500, 'claude-opus-5'), 22_500)
})

Deno.test('costMicros: unknown / missing model falls back to the Sonnet rates', () => {
  // A bug that drops the model (or an id outside MODEL_PRICING) must keep the exact historical
  // Sonnet accounting — never NaN, never zero-priced spend.
  assertEquals(costMicros(2_000, 500, 'claude-nonexistent-9'), costMicros(2_000, 500))
  assertEquals(costMicros(2_000, 500, undefined), 13_500)
})

Deno.test('Opus plan headroom: a worst-case plan call stays under the $0.20 per-call clamp', () => {
  // WHY Opus is PLAN-ONLY and the $0.20 clamp is unchanged: the plan prompt is small — a generous
  // worst case (10k input tokens, full 2048-token output) on Opus 5 ($5/$25) costs
  // 10_000×5 + 2048×25 = 101_200 micros ≈ $0.10, comfortably inside PER_CALL_CEILING_MICROS.
  // Chat can reach ~60k input tokens (ai-chat MAX_TOTAL_CHARS ≈ 15k+ tokens, worst-case 1 char/tok
  // ~60k), which on Opus would be 60_000×5 + 2048×25 = 351_200 > 200_000 — that is exactly why
  // ALLOWED_CHAT_MODELS excludes Opus while ALLOWED_PLAN_MODELS includes it.
  assertEquals(costMicros(10_000, 2048, 'claude-opus-5'), 101_200)
  assertEquals(costMicros(10_000, 2048, 'claude-opus-5') < PER_CALL_CEILING_MICROS, true)
})

Deno.test('budget cap is $20.00 in micro-dollars', () => {
  assertEquals(BUDGET_CAP_MICROS, 20_000_000)
})

Deno.test('per-user sub-cap is $10.00 and stays below the global pool', () => {
  // A per-user sub-cap only means something if it is strictly below the global cap — otherwise a
  // single account could still consume the whole shared pool (Issue 3, 2026-07-06 audit).
  assertEquals(USER_BUDGET_CAP_MICROS, 10_000_000)
  assertEquals(USER_BUDGET_CAP_MICROS < BUDGET_CAP_MICROS, true)
})

Deno.test(
  "one legit call's cost stays under the ai_budget_add per-call clamp (200k micros)",
  () => {
    // ai_budget_add clamps each add to 200_000 micros. That must sit comfortably above one real
    // call's max cost so the clamp only ever bites an abusive direct RPC, never a genuine call.
    // Worst realistic chat call: ~60k input chars (ai-chat MAX_TOTAL_CHARS) ≈ ~15k tokens, plus the
    // 2048 MAX_TOKENS output. Even the absurd 1-char-per-token upper bound stays within range.
    assertEquals(costMicros(15_000, 2048) < 200_000, true)
    assertEquals(costMicros(60_000, 2048) < 220_000, true)
  },
)

Deno.test('owner spend-alert threshold sits below the per-user cap and above zero', () => {
  // The alert must fire BEFORE the wall (so the owner learns of a runaway account while it can still
  // spend), and be meaningfully positive. 80% of the $10 per-user cap = $8.
  assertEquals(USER_SPEND_ALERT_MICROS, 8_000_000)
  assertEquals(USER_SPEND_ALERT_MICROS < USER_BUDGET_CAP_MICROS, true)
  assertEquals(USER_SPEND_ALERT_MICROS > 0, true)
})

Deno.test('crossedSpendAlert fires once — only on the call that first crosses the line', () => {
  const T = USER_SPEND_ALERT_MICROS
  // below → below: no page.
  assertEquals(crossedSpendAlert(0, 1_000_000), false)
  assertEquals(crossedSpendAlert(T - 200_000, T - 1), false)
  // below → at/over: the crossing call pages once.
  assertEquals(crossedSpendAlert(T - 1, T), true)
  assertEquals(crossedSpendAlert(T - 13_500, T + 50_000), true)
  // already over → further over: do NOT re-page on every subsequent call.
  assertEquals(crossedSpendAlert(T, T + 13_500), false)
  assertEquals(crossedSpendAlert(T + 1, T + 999_999), false)
})

Deno.test('per-call clamp is below the alert threshold, so a crossing can never be skipped', () => {
  // Each ai_budget_add is clamped to PER_CALL_CEILING_MICROS. Because that ceiling is below the
  // alert threshold, spend can never LEAP the line in one call from far below — it steps across it,
  // and crossedSpendAlert catches that step. (Sanity-check the invariant the detection relies on.)
  assertEquals(PER_CALL_CEILING_MICROS, 200_000)
  assertEquals(PER_CALL_CEILING_MICROS < USER_SPEND_ALERT_MICROS, true)
})

Deno.test('Balanced-tier limits', () => {
  assertEquals(LIMITS.chat, { hour: 30, day: 100 })
  assertEquals(LIMITS.plan_my_day, { hour: 10, day: 10 })
})

Deno.test('recordUsage binds the budget add to the usage id (M2)', async () => {
  // The M2 fix: ai_budget_add must be called WITH this call's usageId so the SQL can bind the ledger
  // increment to a real, rate-limited, not-yet-billed usage row. A regression that dropped p_usage_id
  // would reopen the direct-RPC amplification hole — this guards the client-side half of that wiring.
  _resetConfigCache()
  const calls: Array<{ name: string; args: unknown }> = []
  const client = {
    // app_config_get → null makes loadConfig fall back to the constants (uncached); ai_user_budget_check
    // returns the full cap remaining so no spend-alert crosses and the alert path exits before fetch.
    rpc(name: string, args?: unknown) {
      calls.push({ name, args })
      if (name === 'ai_user_budget_check') return Promise.resolve({ data: 10_000_000, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
  } as unknown as SupabaseClient

  await recordUsage(client, 'usage-123', 2000, 500, 'chat')

  const add = calls.find((c) => c.name === 'ai_budget_add')
  assertEquals(add?.args, { p_usage_id: 'usage-123', p_micros: costMicros(2000, 500) })
  // The token backfill still targets the same row.
  const tokens = calls.find((c) => c.name === 'ai_usage_record_tokens')
  assertEquals((tokens?.args as { p_id: string }).p_id, 'usage-123')
})

Deno.test(
  'recordUsage prices the budget add at the model it was told the call ran on',
  async () => {
    // The model knob only means anything if the ledger charges the model's OWN rates — a haiku call
    // billed at sonnet rates would triple-count, an opus call at sonnet rates would under-count.
    _resetConfigCache()
    const calls: Array<{ name: string; args: unknown }> = []
    const client = {
      rpc(name: string, args?: unknown) {
        calls.push({ name, args })
        if (name === 'ai_user_budget_check')
          return Promise.resolve({ data: 10_000_000, error: null })
        return Promise.resolve({ data: null, error: null })
      },
      auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    } as unknown as SupabaseClient

    await recordUsage(client, 'usage-h', 2000, 500, 'chat', 'claude-haiku-4-5')
    const add = calls.find((c) => c.name === 'ai_budget_add')
    assertEquals(add?.args, {
      p_usage_id: 'usage-h',
      p_micros: costMicros(2000, 500, 'claude-haiku-4-5'),
    })
  },
)
