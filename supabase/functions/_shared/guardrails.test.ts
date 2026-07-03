// Deno unit tests for the pure guardrail logic (the DB-backed parts are proven by the psql
// guardrail proof). Run: deno test --no-check supabase/functions/_shared/
import { assertEquals } from 'jsr:@std/assert@1'
import { costMicros, BUDGET_CAP_MICROS, LIMITS } from './guardrails.ts'

Deno.test('costMicros: Sonnet 5 standard pricing ($3/$15 per 1M) → micro-dollars', () => {
  // 1M input = $3 = 3,000,000 micros; 1M output = $15 = 15,000,000 micros.
  assertEquals(costMicros(1_000_000, 0), 3_000_000)
  assertEquals(costMicros(0, 1_000_000), 15_000_000)
  assertEquals(costMicros(1_000_000, 1_000_000), 18_000_000)
  // A small realistic chat turn: 2k in, 500 out → 2000*3 + 500*15 = 13,500 micros ($0.0135).
  assertEquals(costMicros(2_000, 500), 13_500)
  assertEquals(costMicros(0, 0), 0)
})

Deno.test('budget cap is $20.00 in micro-dollars', () => {
  assertEquals(BUDGET_CAP_MICROS, 20_000_000)
})

Deno.test('Balanced-tier limits', () => {
  assertEquals(LIMITS.chat, { hour: 30, day: 100 })
  assertEquals(LIMITS.plan_my_day, { hour: 10, day: 10 })
})
