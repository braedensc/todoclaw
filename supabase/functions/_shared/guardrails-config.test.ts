// Deno unit tests for the runtime guardrail-config loader (guardrails-config.ts). The DB-backed
// app_config_get RPC is proven by the psql guardrail proof; here we prove the pure parse/clamp logic
// plus the cache + fallback behavior with a fake client.
// Run: deno test --no-check supabase/functions/_shared/
import { assert, assertEquals } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import {
  loadConfig,
  parseConfig,
  FALLBACK_CONFIG,
  HARD_MAX,
  CACHE_TTL_MS,
  _resetConfigCache,
} from './guardrails-config.ts'
import {
  BUDGET_CAP_MICROS,
  USER_BUDGET_CAP_MICROS,
  AI_BUDGET_BASE_MICROS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_PLAN_MODEL,
  LIMITS,
} from './guardrails-constants.ts'

// A fake client whose .rpc(name) returns a fixed reply and counts the calls (loadConfig only ever
// calls rpc('app_config_get')).
function fake(reply: { data?: unknown; error?: { message: string } | null }) {
  let calls = 0
  const client = {
    rpc(_name: string) {
      calls++
      return Promise.resolve(reply)
    },
  } as unknown as SupabaseClient
  return { client, calls: () => calls }
}

// A well-formed app_config_get() payload == the seeded defaults. Deliberately WITHOUT the
// 2026-08-20 optional keys (chatModel/planModel/aiBudgetBaseMicros) — the pre-migration shape,
// which must keep parsing (see the optional-key tests below).
const seed = {
  globalBudgetCapMicros: BUDGET_CAP_MICROS,
  userBudgetCapMicros: USER_BUDGET_CAP_MICROS,
  chatHourLimit: LIMITS.chat.hour,
  chatDayLimit: LIMITS.chat.day,
  planHourLimit: LIMITS.plan_my_day.hour,
  planDayLimit: LIMITS.plan_my_day.day,
}

Deno.test('FALLBACK_CONFIG is exactly the guardrails constants (single source of truth)', () => {
  assertEquals(FALLBACK_CONFIG.globalBudgetCapMicros, BUDGET_CAP_MICROS)
  assertEquals(FALLBACK_CONFIG.userBudgetCapMicros, USER_BUDGET_CAP_MICROS)
  assertEquals(FALLBACK_CONFIG.budgetBaseMicros, AI_BUDGET_BASE_MICROS)
  assertEquals(FALLBACK_CONFIG.chatModel, DEFAULT_CHAT_MODEL)
  assertEquals(FALLBACK_CONFIG.planModel, DEFAULT_PLAN_MODEL)
  assertEquals(FALLBACK_CONFIG.limits, LIMITS)
})

Deno.test('HARD_MAX ceilings are >= the defaults (seeding never trips a read-side clamp)', () => {
  assert(HARD_MAX.global >= BUDGET_CAP_MICROS)
  assert(HARD_MAX.user >= USER_BUDGET_CAP_MICROS)
  assert(HARD_MAX.base >= AI_BUDGET_BASE_MICROS)
  assert(HARD_MAX.chatHour >= LIMITS.chat.hour)
  assert(HARD_MAX.chatDay >= LIMITS.chat.day)
  assert(HARD_MAX.planHour >= LIMITS.plan_my_day.hour)
  assert(HARD_MAX.planDay >= LIMITS.plan_my_day.day)
  // The per-user cap must stay below the global pool to mean anything.
  assert(HARD_MAX.user <= HARD_MAX.global)
})

Deno.test('parseConfig: valid payload → the config unchanged (within range)', () => {
  assertEquals(parseConfig(seed), {
    globalBudgetCapMicros: BUDGET_CAP_MICROS,
    userBudgetCapMicros: USER_BUDGET_CAP_MICROS,
    budgetBaseMicros: AI_BUDGET_BASE_MICROS,
    chatModel: DEFAULT_CHAT_MODEL,
    planModel: DEFAULT_PLAN_MODEL,
    limits: LIMITS,
  })
})

Deno.test(
  'parseConfig: the 2026-08-20 keys are OPTIONAL — absent ⇒ defaults, config intact',
  () => {
    // Functions auto-deploy on merge, so a new build can read a PRE-migration app_config row. The
    // model/base keys being absent must yield their defaults — NOT collapse the whole config to
    // FALLBACK_CONFIG (which would wipe the owner's tuned caps).
    const tuned = { ...seed, globalBudgetCapMicros: 42_000_000, chatHourLimit: 99 }
    const c = parseConfig(tuned)
    assert(c !== null)
    assertEquals(c.globalBudgetCapMicros, 42_000_000) // tuned value survives
    assertEquals(c.limits.chat.hour, 99)
    assertEquals(c.chatModel, DEFAULT_CHAT_MODEL)
    assertEquals(c.planModel, DEFAULT_PLAN_MODEL)
    assertEquals(c.budgetBaseMicros, AI_BUDGET_BASE_MICROS)
  },
)

Deno.test('parseConfig: valid model values are honored (haiku chat, opus plan)', () => {
  const c = parseConfig({
    ...seed,
    chatModel: 'claude-haiku-4-5',
    planModel: 'claude-opus-5',
    aiBudgetBaseMicros: 25_000_000,
  })
  assert(c !== null)
  assertEquals(c.chatModel, 'claude-haiku-4-5')
  assertEquals(c.planModel, 'claude-opus-5')
  assertEquals(c.budgetBaseMicros, 25_000_000)
})

Deno.test(
  'parseConfig: an invalid model value falls back for THAT key only — config otherwise intact',
  () => {
    // Opus is NOT in the chat allowlist (per-call clamp math); a stored opus chatModel must
    // degrade to the default chat model while the rest — including a valid planModel and the
    // owner's tuned caps — parses through untouched.
    const c = parseConfig({
      ...seed,
      globalBudgetCapMicros: 42_000_000,
      chatModel: 'claude-opus-5',
      planModel: 'claude-haiku-4-5',
    })
    assert(c !== null)
    assertEquals(c.chatModel, DEFAULT_CHAT_MODEL)
    assertEquals(c.planModel, 'claude-haiku-4-5')
    assertEquals(c.globalBudgetCapMicros, 42_000_000)
    // Wrong types degrade the same way (never null the whole config).
    const d = parseConfig({ ...seed, chatModel: 7, planModel: null, aiBudgetBaseMicros: 'x' })
    assert(d !== null)
    assertEquals(d.chatModel, DEFAULT_CHAT_MODEL)
    assertEquals(d.planModel, DEFAULT_PLAN_MODEL)
    assertEquals(d.budgetBaseMicros, AI_BUDGET_BASE_MICROS)
  },
)

Deno.test('parseConfig: aiBudgetBaseMicros clamps to HARD_MAX.base (read-side defense)', () => {
  const c = parseConfig({ ...seed, aiBudgetBaseMicros: 999_000_000 })
  assert(c !== null)
  assertEquals(c.budgetBaseMicros, HARD_MAX.base)
  const d = parseConfig({ ...seed, aiBudgetBaseMicros: -5 })
  assert(d !== null)
  assertEquals(d.budgetBaseMicros, 0)
})

Deno.test('parseConfig: over-max values are clamped to HARD_MAX (read-side defense)', () => {
  const c = parseConfig({
    globalBudgetCapMicros: 999_000_000,
    userBudgetCapMicros: 999_000_000,
    chatHourLimit: 9999,
    chatDayLimit: 99_999,
    planHourLimit: 9999,
    planDayLimit: 9999,
  })
  assert(c !== null)
  assertEquals(c.globalBudgetCapMicros, HARD_MAX.global)
  assertEquals(c.userBudgetCapMicros, HARD_MAX.user)
  assertEquals(c.limits.chat, { hour: HARD_MAX.chatHour, day: HARD_MAX.chatDay })
  assertEquals(c.limits.plan_my_day, { hour: HARD_MAX.planHour, day: HARD_MAX.planDay })
})

Deno.test(
  'parseConfig: a stored 0 cap is preserved (intentional kill-switch, not "missing")',
  () => {
    const c = parseConfig({ ...seed, globalBudgetCapMicros: 0, userBudgetCapMicros: 0 })
    assert(c !== null)
    assertEquals(c.globalBudgetCapMicros, 0)
    assertEquals(c.userBudgetCapMicros, 0)
  },
)

Deno.test('parseConfig: negatives clamp up to 0', () => {
  const c = parseConfig({ ...seed, globalBudgetCapMicros: -5, chatHourLimit: -1 })
  assert(c !== null)
  assertEquals(c.globalBudgetCapMicros, 0)
  assertEquals(c.limits.chat.hour, 0)
})

Deno.test('parseConfig: malformed / missing / wrong-typed → null (→ caller falls back)', () => {
  assertEquals(parseConfig(null), null)
  assertEquals(parseConfig(undefined), null)
  assertEquals(parseConfig({}), null)
  assertEquals(parseConfig({ ...seed, globalBudgetCapMicros: 'x' }), null)
  assertEquals(parseConfig({ ...seed, planDayLimit: Number.NaN }), null)
})

Deno.test('loadConfig: RPC error → FALLBACK and is NOT cached (retries next call)', async () => {
  _resetConfigCache()
  const f = fake({ error: { message: 'boom' } })
  assertEquals(await loadConfig(f.client, 1000), FALLBACK_CONFIG)
  assertEquals(await loadConfig(f.client, 1000), FALLBACK_CONFIG)
  assertEquals(f.calls(), 2) // a failed read is never cached
})

Deno.test('loadConfig: null data → FALLBACK, uncached', async () => {
  _resetConfigCache()
  const f = fake({ data: null })
  assertEquals(await loadConfig(f.client, 1000), FALLBACK_CONFIG)
  assertEquals(f.calls(), 1)
})

Deno.test(
  'loadConfig: a successful read is cached within TTL, refetched after it expires',
  async () => {
    _resetConfigCache()
    const f = fake({ data: seed })
    await loadConfig(f.client, 1000)
    await loadConfig(f.client, 1000 + CACHE_TTL_MS - 1) // within TTL → cache hit
    assertEquals(f.calls(), 1)
    await loadConfig(f.client, 1000 + CACHE_TTL_MS + 1) // expired → refetch
    assertEquals(f.calls(), 2)
  },
)
