import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { generateInviteCode, redeemUrl } from './invite-code.ts'

Deno.test('generateInviteCode: 16 bytes → 26 Crockford-base32 chars', () => {
  const code = generateInviteCode()
  assertEquals(code.length, 26)
  // Crockford alphabet only: digits + A–Z minus I, L, O, U.
  assertMatch(code, /^[0-9A-HJKMNP-TV-Z]+$/)
})

Deno.test('generateInviteCode: excludes the ambiguous letters I, L, O, U', () => {
  // Sample enough codes that any leaked letter would almost certainly show up.
  const joined = Array.from({ length: 200 }, () => generateInviteCode()).join('')
  for (const ch of ['I', 'L', 'O', 'U']) {
    assert(!joined.includes(ch), `code alphabet must not contain ${ch}`)
  }
})

Deno.test('generateInviteCode: high entropy → no collisions across many draws', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 1000; i++) seen.add(generateInviteCode())
  assertEquals(seen.size, 1000)
})

Deno.test('generateInviteCode: byteLength controls length', () => {
  // ceil(bytes * 8 / 5) chars.
  assertEquals(generateInviteCode(10).length, 16)
  assertEquals(generateInviteCode(20).length, 32)
})

Deno.test('redeemUrl: builds a hash-routed redeem link with an encoded code', () => {
  assertEquals(
    redeemUrl('https://app.example.com', 'ABC123'),
    'https://app.example.com/#/redeem?code=ABC123',
  )
})

Deno.test('redeemUrl: empty origin yields a relative URL the client can complete', () => {
  assertEquals(redeemUrl('', 'ABC123'), '/#/redeem?code=ABC123')
})
