// Tests for the system guardrail wrappers (guardrails-system.ts). A fake Supabase client records the
// RPC calls and returns queued responses, so we can prove: the precheck ordering (global → per-user →
// rate limit), that an exhausted gate short-circuits before recording a rate-limit unit, the argument
// shapes, and that recordUsageForUser posts the right micro cost and is best-effort.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { precheckForUser, recordUsageForUser } from './guardrails-system.ts'
import { BUDGET_CAP_MICROS, USER_BUDGET_CAP_MICROS, LIMITS, costMicros } from './guardrails.ts'
import { AI_BUDGET_BASE_MICROS } from './guardrails-constants.ts'
import { _resetConfigCache } from './guardrails-config.ts'
import { _resetActiveCountCache, _resetGlobalTripAlert } from './effective-cap.ts'

// precheckForUser loads app_config first (loadConfig), then the active-user count (loadEffectiveCap,
// 2026-08-20 scaled cap). The fake returns null for BOTH app_config_get and ai_active_user_count
// (not in its replies), so the config falls back to the constants and the count fail-safes to 0 —
// making the enforced global cap = AI_BUDGET_BASE_MICROS (base only), the scaled formula's floor.
// Reset the per-isolate caches before each precheck test so the reads are deterministic.

function resetCaches() {
  _resetConfigCache()
  _resetActiveCountCache()
  _resetGlobalTripAlert()
}

type RpcReply = { data?: unknown; error?: { message: string } | null } | (() => never)

interface FakeClient {
  calls: { name: string; args: Record<string, unknown> }[]
  client: SupabaseClient
}

function fakeClient(replies: Record<string, RpcReply>): FakeClient {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      const reply = replies[name]
      if (typeof reply === 'function') reply() // throw path
      return Promise.resolve(reply ?? { data: null, error: null })
    },
  } as unknown as SupabaseClient
  return { calls, client }
}

Deno.test('precheckForUser: all gates clear → ok, records the request, correct args', async () => {
  resetCaches()
  const f = fakeClient({
    ai_budget_check_system: { data: 5_000_000 },
    ai_user_budget_check_for_user: { data: 4_000_000 },
    ai_usage_check_and_record_for_user: { data: 'usage-123' },
  })
  const res = await precheckForUser(f.client, 'user-1', 'plan_my_day')
  assertEquals(res, { ok: true, usageId: 'usage-123' })

  // loadConfig reads app_config first (→ constants via fallback), then the active-user count
  // (→ null ⇒ 0, fail-safe); the global gate therefore enforces the SCALED cap's floor — base
  // only, NOT the flat BUDGET_CAP_MICROS. Per-user + rate-limit calls carry the explicit user id.
  assertEquals(f.calls[0].name, 'app_config_get')
  assertEquals(f.calls[1].name, 'ai_active_user_count')
  assertEquals(f.calls[2], {
    name: 'ai_budget_check_system',
    args: { p_cap_micros: AI_BUDGET_BASE_MICROS },
  })
  assertEquals(f.calls[3].args, { p_user_id: 'user-1', p_cap_micros: USER_BUDGET_CAP_MICROS })
  assertEquals(f.calls[4].args, {
    p_user_id: 'user-1',
    p_feature: 'plan_my_day',
    p_hour_limit: LIMITS.plan_my_day.hour,
    p_day_limit: LIMITS.plan_my_day.day,
  })
})

Deno.test('precheckForUser (reader 3): the cap scales with the active-user count', async () => {
  resetCaches()
  // 3 active spenders on the fallback config: base $10 + $10×3 = $40 → clamped by the $20
  // fallback ceiling — the dispatcher enforces the exact same formula as the interactive readers.
  const f = fakeClient({
    ai_active_user_count: { data: 3 },
    ai_budget_check_system: { data: 5_000_000 },
    ai_user_budget_check_for_user: { data: 4_000_000 },
    ai_usage_check_and_record_for_user: { data: 'usage-123' },
  })
  await precheckForUser(f.client, 'user-1', 'plan_my_day')
  assertEquals(f.calls[2], {
    name: 'ai_budget_check_system',
    args: { p_cap_micros: BUDGET_CAP_MICROS },
  })
  resetCaches() // drop the cached count
})

Deno.test(
  'precheckForUser: global pool exhausted → budget-exhausted, no rate-limit record',
  async () => {
    resetCaches()
    const f = fakeClient({
      ai_budget_check_system: { data: 0 },
      ai_user_budget_check_for_user: { data: 4_000_000 },
      ai_usage_check_and_record_for_user: { data: 'should-not-happen' },
    })
    const res = await precheckForUser(f.client, 'user-1', 'plan_my_day')
    assertEquals(res, { ok: false, reason: 'budget-exhausted' })
    // Short-circuits after the config + count reads + global check (never charge a rate-limit unit
    // on a paused month). No webhook env in tests, so the trip alert is a no-op.
    assertEquals(
      f.calls.map((c) => c.name),
      ['app_config_get', 'ai_active_user_count', 'ai_budget_check_system'],
    )
  },
)

Deno.test('precheckForUser: a global trip pages the owner via the shared alert', async () => {
  resetCaches()
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
    const f = fakeClient({ ai_budget_check_system: { data: 0 } })
    const res = await precheckForUser(f.client, 'user-1', 'plan_my_day')
    assertEquals(res, { ok: false, reason: 'budget-exhausted' })
    assertEquals(posts, 1)
    assertEquals(lastBody.event, 'ai_global_budget_tripped')
    assertEquals(lastBody.source, 'dispatch:plan_my_day')
    // Deduped within the period/isolate — the cron sweeping many users pages once, not per user.
    await precheckForUser(f.client, 'user-2', 'plan_my_day')
    assertEquals(posts, 1)
  } finally {
    globalThis.fetch = realFetch
    Deno.env.delete('AI_SPEND_ALERT_WEBHOOK_URL')
    resetCaches()
  }
})

Deno.test(
  'precheckForUser: per-user sub-cap hit → budget-exhausted (user-monthly-cap)',
  async () => {
    resetCaches()
    const f = fakeClient({
      ai_budget_check_system: { data: 5_000_000 },
      ai_user_budget_check_for_user: { data: 0 },
    })
    const res = await precheckForUser(f.client, 'user-1', 'plan_my_day')
    assertEquals(res, { ok: false, reason: 'budget-exhausted', detail: 'user-monthly-cap' })
    assertEquals(
      f.calls.map((c) => c.name),
      [
        'app_config_get',
        'ai_active_user_count',
        'ai_budget_check_system',
        'ai_user_budget_check_for_user',
      ],
    )
  },
)

Deno.test('precheckForUser: rate limit raised by the RPC → rate-limited', async () => {
  resetCaches()
  const f = fakeClient({
    ai_budget_check_system: { data: 5_000_000 },
    ai_user_budget_check_for_user: { data: 4_000_000 },
    ai_usage_check_and_record_for_user: { error: { message: 'rate_limited_day' } },
  })
  const res = await precheckForUser(f.client, 'user-1', 'plan_my_day')
  assertEquals(res, { ok: false, reason: 'rate-limited', detail: 'rate_limited_day' })
})

Deno.test('recordUsageForUser: posts the exact micro cost to ai_budget_add_for_user', async () => {
  const f = fakeClient({ ai_budget_add_for_user: { data: null } })
  await recordUsageForUser(f.client, 'user-1', 1000, 500)
  assertEquals(f.calls.length, 1)
  assertEquals(f.calls[0], {
    name: 'ai_budget_add_for_user',
    args: { p_user_id: 'user-1', p_micros: costMicros(1000, 500) },
  })
})

Deno.test('recordUsageForUser: prices the add at the model the dispatcher passed', async () => {
  // The dispatcher threads cfg.planModel through — the ledger must charge that model's own rates
  // (an omitted model bills the conservative Sonnet default, proven by the test above).
  const f = fakeClient({ ai_budget_add_for_user: { data: null } })
  await recordUsageForUser(f.client, 'user-1', 1000, 500, 'claude-opus-5')
  assertEquals(f.calls[0], {
    name: 'ai_budget_add_for_user',
    args: { p_user_id: 'user-1', p_micros: costMicros(1000, 500, 'claude-opus-5') },
  })
})

Deno.test(
  'recordUsageForUser: cache counts land in the priced add (write 1.25× / read 0.1×)',
  async () => {
    // With cache_control on the dispatcher's plan/recap calls, usage.input is the uncached
    // remainder — the add must include the cache terms or the shared budget under-counts.
    const f = fakeClient({ ai_budget_add_for_user: { data: null } })
    await recordUsageForUser(f.client, 'user-1', 1000, 500, 'claude-sonnet-5', 8_000, 2_000)
    assertEquals(f.calls[0], {
      name: 'ai_budget_add_for_user',
      args: {
        p_user_id: 'user-1',
        p_micros: costMicros(1000, 500, 'claude-sonnet-5', 8_000, 2_000),
      },
    })
  },
)

Deno.test('recordUsageForUser: best-effort — a failing RPC never throws', async () => {
  const f = fakeClient({
    ai_budget_add_for_user: () => {
      throw new Error('db down')
    },
  })
  // Must resolve, not reject.
  await recordUsageForUser(f.client, 'user-1', 10, 10)
  assert(true)
})
