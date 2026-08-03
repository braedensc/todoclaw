// Tests for clientIp — the per-IP-throttle key must not be defeatable by a spoofed X-Forwarded-For.
// Run: deno test --no-check supabase/functions/_shared/client-ip.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { clientIp } from './client-ip.ts'

const reqWith = (headers: Record<string, string>) => new Request('https://fn.example', { headers })

Deno.test('clientIp — prefers cf-connecting-ip over a spoofed X-Forwarded-For', () => {
  const req = reqWith({
    'cf-connecting-ip': '9.9.9.9',
    'x-forwarded-for': '1.1.1.1, 9.9.9.9', // 1.1.1.1 is attacker-prepended
  })
  assertEquals(clientIp(req), '9.9.9.9')
})

Deno.test('clientIp — falls back to x-real-ip when cf-connecting-ip is absent', () => {
  assertEquals(clientIp(reqWith({ 'x-real-ip': '9.9.9.9' })), '9.9.9.9')
})

Deno.test(
  'clientIp — with only X-Forwarded-For, uses the rightmost (trusted) hop, not the leftmost',
  () => {
    // Attacker prepends 1.2.3.4; the trusted proxy appended the real 9.9.9.9 on the right.
    assertEquals(clientIp(reqWith({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9' })), '9.9.9.9')
  },
)

Deno.test(
  'clientIp — a lone (spoofable) X-Forwarded-For value is still returned as the rightmost',
  () => {
    assertEquals(clientIp(reqWith({ 'x-forwarded-for': '9.9.9.9' })), '9.9.9.9')
  },
)

Deno.test('clientIp — tolerates surrounding whitespace', () => {
  assertEquals(clientIp(reqWith({ 'x-forwarded-for': '1.2.3.4 ,  9.9.9.9  ' })), '9.9.9.9')
})

Deno.test('clientIp — returns empty when no IP header is present', () => {
  assertEquals(clientIp(reqWith({})), '')
})
