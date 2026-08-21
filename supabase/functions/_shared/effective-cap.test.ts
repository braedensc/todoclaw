// Deno unit tests for the scaled global budget cap (effective-cap.ts): the pure formula, the
// fail-safe + cached active-user count, and the once-per-period global-trip alert dedupe.
// Run: deno test --allow-env --no-check supabase/functions/_shared/
import { assert, assertEquals } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import {
  effectiveCapMicros,
  loadActiveUserCount,
  loadEffectiveCap,
  alertGlobalBudgetTrip,
  utcPeriod,
  COUNT_CACHE_TTL_MS,
  _resetActiveCountCache,
  _resetGlobalTripAlert,
} from './effective-cap.ts'
import { FALLBACK_CONFIG, HARD_MAX, type GuardrailConfig } from './guardrails-config.ts'
import type { GlobalBudgetAlert } from './spend-alert.ts'

// A config like the LIVE post-re-seed one: $10 base + $10/user, $60 manual ceiling.
function cfg(over: Partial<GuardrailConfig> = {}): GuardrailConfig {
  return { ...FALLBACK_CONFIG, globalBudgetCapMicros: 60_000_000, ...over }
}

const ALERT: GlobalBudgetAlert = {
  period: '2026-08',
  capMicros: 30_000_000,
  activeUserCount: 2,
  baseMicros: 10_000_000,
  ceilingMicros: 60_000_000,
  source: 'precheck:chat',
}

// A fake client whose rpc() returns a fixed reply and counts calls.
function fake(reply: { data?: unknown; error?: { message: string } | null } | (() => never)) {
  let calls = 0
  const client = {
    rpc(_name: string) {
      calls++
      if (typeof reply === 'function') reply()
      return Promise.resolve(reply)
    },
  } as unknown as SupabaseClient
  return { client, calls: () => calls }
}

Deno.test('effectiveCapMicros: count 0 → base only (the fail-safe floor)', () => {
  assertEquals(effectiveCapMicros(cfg(), 0), 10_000_000)
})

Deno.test('effectiveCapMicros: scales by the per-user cap per active user', () => {
  assertEquals(effectiveCapMicros(cfg(), 1), 20_000_000) // $10 + $10×1
  assertEquals(effectiveCapMicros(cfg(), 2), 30_000_000) // $10 + $10×2
})

Deno.test('effectiveCapMicros: the manual ceiling clamps the scaled value', () => {
  // $10 + $10×10 = $110 → clamped to the $60 ceiling.
  assertEquals(effectiveCapMicros(cfg(), 10), 60_000_000)
  // The owner can still kill-switch everything by zeroing the ceiling.
  assertEquals(effectiveCapMicros(cfg({ globalBudgetCapMicros: 0 }), 5), 0)
})

Deno.test('effectiveCapMicros: HARD_MAX.global ($100) clamps even a huge ceiling', () => {
  // Even if a stored ceiling somehow bypassed parseConfig's clamp, the formula re-clamps.
  const c = cfg({ globalBudgetCapMicros: 999_000_000 })
  assertEquals(effectiveCapMicros(c, 20), HARD_MAX.global) // $10 + $200 → $100
})

Deno.test('effectiveCapMicros: garbage counts degrade to base — never widen the cap', () => {
  assertEquals(effectiveCapMicros(cfg(), Number.NaN), 10_000_000)
  assertEquals(effectiveCapMicros(cfg(), -3), 10_000_000)
  assertEquals(effectiveCapMicros(cfg(), Number.POSITIVE_INFINITY), 10_000_000)
  assertEquals(effectiveCapMicros(cfg(), 2.7), 30_000_000) // fractional floors to 2
})

Deno.test(
  'loadActiveUserCount: RPC error / null / non-number → 0, NOT cached (retries)',
  async () => {
    _resetActiveCountCache()
    const err = fake({ error: { message: 'boom' } })
    assertEquals(await loadActiveUserCount(err.client, 1000), 0)
    assertEquals(await loadActiveUserCount(err.client, 1000), 0)
    assertEquals(err.calls(), 2) // a failed read is never cached

    _resetActiveCountCache()
    const nul = fake({ data: null })
    assertEquals(await loadActiveUserCount(nul.client, 1000), 0)
    assertEquals(nul.calls(), 1)
    assertEquals(await loadActiveUserCount(nul.client, 1000), 0)
    assertEquals(nul.calls(), 2) // null is a failed read too — uncached

    _resetActiveCountCache()
    const str = fake({ data: 'three' })
    assertEquals(await loadActiveUserCount(str.client, 1000), 0)

    _resetActiveCountCache()
    const thrown = fake(() => {
      throw new Error('network down')
    })
    assertEquals(await loadActiveUserCount(thrown.client, 1000), 0)
  },
)

Deno.test('loadActiveUserCount: cached within the 30s TTL, refetched after expiry', async () => {
  _resetActiveCountCache()
  const f = fake({ data: 3 })
  assertEquals(await loadActiveUserCount(f.client, 1000), 3)
  assertEquals(await loadActiveUserCount(f.client, 1000 + COUNT_CACHE_TTL_MS - 1), 3)
  assertEquals(f.calls(), 1) // within TTL → cache hit
  assertEquals(await loadActiveUserCount(f.client, 1000 + COUNT_CACHE_TTL_MS + 1), 3)
  assertEquals(f.calls(), 2) // expired → refetch
})

Deno.test('loadActiveUserCount: a legitimate 0 (no spenders yet) IS cached', async () => {
  _resetActiveCountCache()
  const f = fake({ data: 0 })
  assertEquals(await loadActiveUserCount(f.client, 1000), 0)
  assertEquals(await loadActiveUserCount(f.client, 1000), 0)
  assertEquals(f.calls(), 1) // 0 is a valid count, not a failure — cached
})

Deno.test('loadEffectiveCap: pairs the cached count with the formula', async () => {
  _resetActiveCountCache()
  const f = fake({ data: 2 })
  assertEquals(await loadEffectiveCap(f.client, cfg(), 1000), {
    capMicros: 30_000_000,
    activeUserCount: 2,
  })
})

Deno.test('utcPeriod formats YYYY-MM in UTC (matches the SQL ledger period key)', () => {
  assertEquals(utcPeriod(new Date(Date.UTC(2026, 7, 20, 12))), '2026-08')
  assertEquals(utcPeriod(new Date(Date.UTC(2026, 11, 31, 23, 59))), '2026-12')
})

Deno.test('alertGlobalBudgetTrip: fires once per period, dedupes the second trip', async () => {
  Deno.env.set('AI_SPEND_ALERT_WEBHOOK_URL', 'https://hooks.example.com/xyz')
  _resetGlobalTripAlert()
  try {
    let posts = 0
    const fakeFetch = (() => {
      posts++
      return Promise.resolve(new Response(null, { status: 204 }))
    }) as unknown as typeof fetch

    assertEquals(await alertGlobalBudgetTrip(ALERT, fakeFetch), true)
    assertEquals(posts, 1)
    // Same period again (every subsequent blocked request) → deduped, no second page.
    assertEquals(await alertGlobalBudgetTrip(ALERT, fakeFetch), false)
    assertEquals(posts, 1)
    // A NEW period trips fresh.
    assertEquals(await alertGlobalBudgetTrip({ ...ALERT, period: '2026-09' }, fakeFetch), true)
    assertEquals(posts, 2)
  } finally {
    Deno.env.delete('AI_SPEND_ALERT_WEBHOOK_URL')
    _resetGlobalTripAlert()
  }
})

Deno.test(
  'alertGlobalBudgetTrip: a failed/unsent alert is NOT marked — the next trip retries',
  async () => {
    _resetGlobalTripAlert()
    // Webhook unset → send returns false → period not marked.
    Deno.env.delete('AI_SPEND_ALERT_WEBHOOK_URL')
    let posts = 0
    const fakeFetch = (() => {
      posts++
      return Promise.resolve(new Response(null, { status: 204 }))
    }) as unknown as typeof fetch
    assertEquals(await alertGlobalBudgetTrip(ALERT, fakeFetch), false)
    assertEquals(posts, 0)

    // Owner configures the webhook mid-month → the still-tripped pool pages on the next attempt.
    Deno.env.set('AI_SPEND_ALERT_WEBHOOK_URL', 'https://hooks.example.com/xyz')
    try {
      assertEquals(await alertGlobalBudgetTrip(ALERT, fakeFetch), true)
      assertEquals(posts, 1)

      // A throwing transport is swallowed (returns false), also unmarked.
      _resetGlobalTripAlert()
      const boom = (() => Promise.reject(new Error('net down'))) as unknown as typeof fetch
      assertEquals(await alertGlobalBudgetTrip(ALERT, boom), false)
      assertEquals(await alertGlobalBudgetTrip(ALERT, fakeFetch), true) // retried and delivered
    } finally {
      Deno.env.delete('AI_SPEND_ALERT_WEBHOOK_URL')
      _resetGlobalTripAlert()
    }
  },
)

Deno.test(
  'scaled-cap invariants: fallback config keeps solo-month spend near the old bound',
  () => {
    // With the FALLBACK config (config outage): base $10, ceiling $20 — count 0 gives $10, and no
    // count can push past the old $20 fallback ceiling. An outage always degrades TIGHTER.
    assertEquals(effectiveCapMicros(FALLBACK_CONFIG, 0), 10_000_000)
    assertEquals(effectiveCapMicros(FALLBACK_CONFIG, 100), 20_000_000)
    assert(HARD_MAX.global === 100_000_000)
  },
)
