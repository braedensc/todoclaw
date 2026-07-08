// Deno unit tests for the owner gate (owner.ts). Run: deno test --no-check supabase/functions/_shared/
import { assertEquals } from 'jsr:@std/assert@1'
import { isOwner } from './owner.ts'

Deno.test('isOwner: caller id matches the owner env → true', () => {
  assertEquals(isOwner('user-1', 'user-1'), true)
})

Deno.test('isOwner: mismatch → false', () => {
  assertEquals(isOwner('user-1', 'someone-else'), false)
})

Deno.test('isOwner: OWNER_USER_ID unset → false (safe default — nobody is owner)', () => {
  assertEquals(isOwner('user-1', undefined), false)
  assertEquals(isOwner('user-1', null), false)
  assertEquals(isOwner('user-1', ''), false)
})

Deno.test('isOwner: missing caller id → false (never matches an empty/absent id)', () => {
  assertEquals(isOwner(undefined, 'user-1'), false)
  assertEquals(isOwner(null, 'user-1'), false)
  assertEquals(isOwner('', 'user-1'), false)
  // The dangerous case: unset on BOTH sides must NOT read as a match.
  assertEquals(isOwner('', ''), false)
})
