// Deno unit tests for the pure guardrail logic (the DB-backed parts are proven by the psql
// guardrail proof). Run: deno test --no-check supabase/functions/_shared/
import { assertEquals } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import {
  costMicros,
  precheck,
  getStatus,
  recordUsage,
  BUDGET_CAP_MICROS,
  USER_BUDGET_CAP_MICROS,
  USER_SPEND_ALERT_MICROS,
  PER_CALL_CEILING_MICROS,
  crossedSpendAlert,
  LIMITS,
} from './guardrails.ts'
import { _resetConfigCache } from './guardrails-config.ts'
import { AI_BUDGET_BASE_MICROS } from './guardrails-constants.ts'
import { _resetActiveCountCache, _resetGlobalTripAlert } from './effective-cap.ts'

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

Deno.test('costMicros: cache terms — write 1.25× and read 0.1× of the model input rate', () => {
  // With cache_control in play, input_tokens is the UNCACHED REMAINDER — the cache terms carry
  // the rest of the bill. Per model (input rate micros/token: haiku 1, sonnet 3, opus 5):
  // Sonnet: 10k cache-write = 10_000×3×1.25 = 37_500; 10k cache-read = 10_000×3×0.1 = 3_000.
  assertEquals(costMicros(0, 0, 'claude-sonnet-5', 10_000, 0), 37_500)
  assertEquals(costMicros(0, 0, 'claude-sonnet-5', 0, 10_000), 3_000)
  // Haiku: 10_000×1×1.25 = 12_500; 10_000×1×0.1 = 1_000.
  assertEquals(costMicros(0, 0, 'claude-haiku-4-5', 10_000, 0), 12_500)
  assertEquals(costMicros(0, 0, 'claude-haiku-4-5', 0, 10_000), 1_000)
  // Opus: 10_000×5×1.25 = 62_500; 10_000×5×0.1 = 5_000.
  assertEquals(costMicros(0, 0, 'claude-opus-5', 10_000, 0), 62_500)
  assertEquals(costMicros(0, 0, 'claude-opus-5', 0, 10_000), 5_000)
  // All four terms sum (sonnet): 2000×3 + 500×15 + 1000×3.75 + 4000×0.3 = 18_450.
  assertEquals(costMicros(2_000, 500, 'claude-sonnet-5', 1_000, 4_000), 18_450)
  // Omitted cache counts default to 0 — every pre-caching caller keeps its exact cost.
  assertEquals(costMicros(2_000, 500, 'claude-sonnet-5'), 13_500)
  // One rounding at the end, not per term: 3 read tokens on haiku = 0.3 micros → rounds to 0,
  // and a mixed sum rounds once (1 write + 3 reads on haiku = 1.25 + 0.3 = 1.55 → 2).
  assertEquals(costMicros(0, 0, 'claude-haiku-4-5', 0, 3), 0)
  assertEquals(costMicros(0, 0, 'claude-haiku-4-5', 1, 3), 2)
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

Deno.test('per-call clamp headroom with prompt caching (re-derived, phase-0 PR 3)', () => {
  // Cache writes bill at 1.25× the input rate, so the ABSURD worst case worsens slightly: a
  // 60k-token sonnet chat prompt written to cache in full = 60_000×3×1.25 + 2048×15 = 255_720
  // micros, vs 210_720 uncached — both already past the fixed 200_000 clamp, so the clamp's
  // under-count at that unreachable extreme grows by ~$0.045 and remains acceptable (the ledger
  // still advances by the clamped $0.20; the kill-switch can only trip EARLY elsewhere because
  // every REALISTIC call is far below the clamp).
  assertEquals(costMicros(0, 2048, 'claude-sonnet-5', 60_000, 0), 255_720)
  // Realistic worst case (~15k tokens all cache-written): 15_000×3×1.25 + 2048×15 = 86_970 —
  // comfortably inside the clamp, so genuine calls are never clipped.
  assertEquals(costMicros(0, 2048, 'claude-sonnet-5', 15_000, 0) < 200_000, true)
  // Haiku (the future chat flip): even the absurd all-cache-write 60k case is tiny —
  // 60_000×1×1.25 + 2048×5 = 85_240 micros (~$0.085), huge headroom under the clamp.
  assertEquals(costMicros(0, 2048, 'claude-haiku-4-5', 60_000, 0), 85_240)
  assertEquals(costMicros(0, 2048, 'claude-haiku-4-5', 60_000, 0) < 200_000, true)
  // Cache READS make calls cheaper than uncached, never dearer — a fully-read prompt costs ~8%
  // of the same prompt uncached (0.1×), so reads can only widen headroom.
  assertEquals(
    costMicros(0, 2048, 'claude-sonnet-5', 0, 60_000) < costMicros(60_000, 2048, 'claude-sonnet-5'),
    true,
  )
})

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
  // The token backfill still targets the same row — now via the 5-param RPC (cache counts default
  // to 0 when the caller has none, so the pre-caching call shape prices identically).
  const tokens = calls.find((c) => c.name === 'ai_usage_record_tokens')
  assertEquals(tokens?.args, {
    p_id: 'usage-123',
    p_input: 2000,
    p_output: 500,
    p_cache_creation: 0,
    p_cache_read: 0,
  })
})

Deno.test('recordUsage forwards the cache counts — RPC params AND the priced add', async () => {
  // The core invariant of the caching PR: shipping cache_control without this forwarding silently
  // breaks the kill-switch (input_tokens alone is just the uncached remainder). Both halves must
  // carry the counts: the observability row (5-param ai_usage_record_tokens) and the ledger add
  // (costMicros with the write/read terms).
  _resetConfigCache()
  const calls: Array<{ name: string; args: unknown }> = []
  const client = {
    rpc(name: string, args?: unknown) {
      calls.push({ name, args })
      if (name === 'ai_user_budget_check') return Promise.resolve({ data: 10_000_000, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
  } as unknown as SupabaseClient

  await recordUsage(client, 'usage-cc', 2000, 500, 'chat', 'claude-sonnet-5', 12_000, 4_000)

  const tokens = calls.find((c) => c.name === 'ai_usage_record_tokens')
  assertEquals(tokens?.args, {
    p_id: 'usage-cc',
    p_input: 2000,
    p_output: 500,
    p_cache_creation: 12_000,
    p_cache_read: 4_000,
  })
  const add = calls.find((c) => c.name === 'ai_budget_add')
  assertEquals(add?.args, {
    p_usage_id: 'usage-cc',
    p_micros: costMicros(2000, 500, 'claude-sonnet-5', 12_000, 4_000),
  })
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

// ─── scaled effective cap: the interactive readers (precheck + getStatus) ───────────────────────

// A fake client with per-RPC replies, plus the .from() chain + auth getStatus needs. An RPC missing
// from `replies` answers { data: null, error: null } — which for app_config_get means "fall back to
// the constants" and for ai_active_user_count means "failed count → 0" (the fail-safe path).
type RpcReply = { data?: unknown; error?: { message: string } | null }

function fakeReaderClient(replies: Record<string, RpcReply>) {
  const calls: { name: string; args?: Record<string, unknown> }[] = []
  const chain = {
    select: () => chain,
    eq: () => chain,
    gt: () => Promise.resolve({ count: 0 }),
  }
  const client = {
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args })
      return Promise.resolve(replies[name] ?? { data: null, error: null })
    },
    from: () => chain,
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
  } as unknown as SupabaseClient
  return { calls, client }
}

function resetCapCaches() {
  _resetConfigCache()
  _resetActiveCountCache()
  _resetGlobalTripAlert()
}

Deno.test('precheck (reader 1): passes the SCALED effective cap to ai_budget_check', async () => {
  resetCapCaches()
  // Fallback config (app_config_get → null) + a failed count (ai_active_user_count → null) ⇒
  // cap = base ($10) — NOT the flat BUDGET_CAP_MICROS ($20). This is the fail-safe floor.
  const f = fakeReaderClient({
    ai_budget_check: { data: 5_000_000 },
    ai_user_budget_check: { data: 4_000_000 },
    ai_usage_check_and_record: { data: 'usage-1' },
  })
  const res = await precheck(f.client, 'chat')
  assertEquals(res, { ok: true, usageId: 'usage-1' })
  const budget = f.calls.find((c) => c.name === 'ai_budget_check')
  assertEquals(budget?.args, { p_cap_micros: AI_BUDGET_BASE_MICROS })
})

Deno.test('precheck: the cap scales with the active-user count (ceiling-clamped)', async () => {
  resetCapCaches()
  // Fallback config: base $10 + $10×5 = $60 → clamped by the $20 fallback ceiling.
  const f = fakeReaderClient({
    ai_active_user_count: { data: 5 },
    ai_budget_check: { data: 5_000_000 },
    ai_user_budget_check: { data: 4_000_000 },
    ai_usage_check_and_record: { data: 'usage-1' },
  })
  await precheck(f.client, 'chat')
  const budget = f.calls.find((c) => c.name === 'ai_budget_check')
  assertEquals(budget?.args, { p_cap_micros: BUDGET_CAP_MICROS })
})

Deno.test('precheck: a live config scales past the old flat cap', async () => {
  resetCapCaches()
  // The post-re-seed shape: $60 ceiling, base $10, per-user $10, 2 active users ⇒ $30 enforced.
  const f = fakeReaderClient({
    app_config_get: {
      data: {
        globalBudgetCapMicros: 60_000_000,
        userBudgetCapMicros: USER_BUDGET_CAP_MICROS,
        aiBudgetBaseMicros: AI_BUDGET_BASE_MICROS,
        chatHourLimit: 30,
        chatDayLimit: 100,
        planHourLimit: 10,
        planDayLimit: 10,
      },
    },
    ai_active_user_count: { data: 2 },
    ai_budget_check: { data: 5_000_000 },
    ai_user_budget_check: { data: 4_000_000 },
    ai_usage_check_and_record: { data: 'usage-1' },
  })
  await precheck(f.client, 'chat')
  const budget = f.calls.find((c) => c.name === 'ai_budget_check')
  assertEquals(budget?.args, { p_cap_micros: 30_000_000 })
  resetCapCaches() // don't leak the cached tuned config into later tests
})

Deno.test('getStatus (reader 2): banner math uses the same effective cap as precheck', async () => {
  resetCapCaches()
  const f = fakeReaderClient({
    ai_active_user_count: { data: 5 },
    ai_budget_check: { data: 2_000_000 },
    ai_user_budget_check: { data: 9_000_000 },
  })
  const status = await getStatus(f.client)
  const budget = f.calls.find((c) => c.name === 'ai_budget_check')
  // Fallback config + 5 active ⇒ ceiling-clamped $20 — identical to what precheck enforces.
  assertEquals(budget?.args, { p_cap_micros: BUDGET_CAP_MICROS })
  assertEquals(status.paused, false)
  assertEquals(status.budgetRemainingMicros, 2_000_000) // min(global, per-user)
})

Deno.test('precheck: a global trip pages the owner once — deduped on the next trip', async () => {
  resetCapCaches()
  Deno.env.set('AI_SPEND_ALERT_WEBHOOK_URL', 'https://hooks.example.com/xyz')
  const realFetch = globalThis.fetch
  let posts = 0
  let lastBody: Record<string, unknown> = {}
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    posts++
    lastBody = JSON.parse((init?.body as string) ?? '{}')
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as unknown as typeof fetch
  try {
    const f = fakeReaderClient({ ai_budget_check: { data: 0 } })
    const res = await precheck(f.client, 'chat')
    assertEquals(res, { ok: false, reason: 'budget-exhausted' })
    assertEquals(posts, 1)
    assertEquals(lastBody.event, 'ai_global_budget_tripped')
    assertEquals(lastBody.source, 'precheck:chat')
    // Every subsequent blocked request in this isolate/period: no re-page.
    await precheck(f.client, 'chat')
    assertEquals(posts, 1)
  } finally {
    globalThis.fetch = realFetch
    Deno.env.delete('AI_SPEND_ALERT_WEBHOOK_URL')
    resetCapCaches()
  }
})
