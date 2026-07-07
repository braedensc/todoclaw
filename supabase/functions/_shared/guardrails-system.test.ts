// Tests for the system guardrail wrappers (guardrails-system.ts). A fake Supabase client records the
// RPC calls and returns queued responses, so we can prove: the precheck ordering (global → per-user →
// rate limit), that an exhausted gate short-circuits before recording a rate-limit unit, the argument
// shapes, and that recordUsageForUser posts the right micro cost and is best-effort.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { precheckForUser, recordUsageForUser } from './guardrails-system.ts'
import { BUDGET_CAP_MICROS, USER_BUDGET_CAP_MICROS, LIMITS, costMicros } from './guardrails.ts'

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
  const f = fakeClient({
    ai_budget_check_system: { data: 5_000_000 },
    ai_user_budget_check_for_user: { data: 4_000_000 },
    ai_usage_check_and_record_for_user: { data: 'usage-123' },
  })
  const res = await precheckForUser(f.client, 'user-1', 'plan_my_day')
  assertEquals(res, { ok: true, usageId: 'usage-123' })

  // Global cap uses the shared constant; per-user + rate-limit calls carry the explicit user id.
  assertEquals(f.calls[0], {
    name: 'ai_budget_check_system',
    args: { p_cap_micros: BUDGET_CAP_MICROS },
  })
  assertEquals(f.calls[1].args, { p_user_id: 'user-1', p_cap_micros: USER_BUDGET_CAP_MICROS })
  assertEquals(f.calls[2].args, {
    p_user_id: 'user-1',
    p_feature: 'plan_my_day',
    p_hour_limit: LIMITS.plan_my_day.hour,
    p_day_limit: LIMITS.plan_my_day.day,
  })
})

Deno.test(
  'precheckForUser: global pool exhausted → budget-exhausted, no rate-limit record',
  async () => {
    const f = fakeClient({
      ai_budget_check_system: { data: 0 },
      ai_user_budget_check_for_user: { data: 4_000_000 },
      ai_usage_check_and_record_for_user: { data: 'should-not-happen' },
    })
    const res = await precheckForUser(f.client, 'user-1', 'plan_my_day')
    assertEquals(res, { ok: false, reason: 'budget-exhausted' })
    // Short-circuits: only the global check ran (never charge a rate-limit unit on a paused month).
    assertEquals(
      f.calls.map((c) => c.name),
      ['ai_budget_check_system'],
    )
  },
)

Deno.test(
  'precheckForUser: per-user sub-cap hit → budget-exhausted (user-monthly-cap)',
  async () => {
    const f = fakeClient({
      ai_budget_check_system: { data: 5_000_000 },
      ai_user_budget_check_for_user: { data: 0 },
    })
    const res = await precheckForUser(f.client, 'user-1', 'plan_my_day')
    assertEquals(res, { ok: false, reason: 'budget-exhausted', detail: 'user-monthly-cap' })
    assertEquals(
      f.calls.map((c) => c.name),
      ['ai_budget_check_system', 'ai_user_budget_check_for_user'],
    )
  },
)

Deno.test('precheckForUser: rate limit raised by the RPC → rate-limited', async () => {
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
