// Tests for ipThrottleOk — the pre-auth per-IP guard must fail open and honor the RPC's verdict.
// Run: deno test --no-check supabase/functions/_shared/ip-throttle.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { ipThrottleOk } from './ip-throttle.ts'

const reqWithIp = (ip?: string) =>
  new Request('https://fn.example', { headers: ip ? { 'cf-connecting-ip': ip } : {} })

// A stub client capturing the rpc args and returning a canned result.
function stubClient(result: { data?: unknown; error?: { message: string } | null }) {
  const calls: { fn: string; args: unknown }[] = []
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args })
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

Deno.test('ipThrottleOk — unknown IP is allowed and never hits the DB', async () => {
  const { client, calls } = stubClient({ data: true })
  assertEquals(await ipThrottleOk(reqWithIp(undefined), 'ai-chat', 10, 60, client), true)
  assertEquals(calls.length, 0, 'no RPC for an unknown IP')
})

Deno.test(
  'ipThrottleOk — under limit (RPC true) → allowed, and forwards the bucket/ip/limit',
  async () => {
    const { client, calls } = stubClient({ data: true })
    assertEquals(await ipThrottleOk(reqWithIp('9.9.9.9'), 'ai-chat', 240, 60, client), true)
    assertEquals(calls[0].fn, 'edge_ip_throttle')
    assertEquals(calls[0].args, {
      p_bucket: 'ai-chat',
      p_ip: '9.9.9.9',
      p_limit: 240,
      p_window_seconds: 60,
    })
  },
)

Deno.test('ipThrottleOk — over limit (RPC false) → blocked', async () => {
  const { client } = stubClient({ data: false })
  assertEquals(await ipThrottleOk(reqWithIp('9.9.9.9'), 'ai-chat', 240, 60, client), false)
})

Deno.test('ipThrottleOk — RPC error fails OPEN (allowed)', async () => {
  const { client } = stubClient({ error: { message: 'boom' } })
  assert(await ipThrottleOk(reqWithIp('9.9.9.9'), 'ai-chat', 240, 60, client))
})
