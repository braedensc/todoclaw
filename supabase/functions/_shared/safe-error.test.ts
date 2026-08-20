// Tests for errorLabel — the AI catch-alls must log a classification, never the error payload
// (an Anthropic SDK error message can embed the user's task/chat text).
// Run: deno test --no-check supabase/functions/_shared/safe-error.test.ts
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { errorLabel } from './safe-error.ts'

Deno.test('errorLabel — plain Error → its class name only', () => {
  assertEquals(errorLabel(new Error('boom')), 'Error')
  assertEquals(errorLabel(new TypeError('bad')), 'TypeError')
})

Deno.test('errorLabel — SDK-style error with a numeric status keeps the status', () => {
  class RateLimitError extends Error {
    status = 429
    constructor(msg: string) {
      super(msg)
      this.name = 'RateLimitError'
    }
  }
  assertEquals(errorLabel(new RateLimitError('overloaded')), 'RateLimitError (status 429)')
})

Deno.test('errorLabel — non-numeric status is ignored, not interpolated', () => {
  const e = new Error('x') as Error & { status: string }
  e.status = 'secret-ish string'
  assertEquals(errorLabel(e), 'Error')
})

Deno.test('errorLabel — non-Error throws report only the typeof', () => {
  assertEquals(errorLabel('a raw string'), 'non-Error thrown (string)')
  assertEquals(errorLabel(undefined), 'non-Error thrown (undefined)')
  assertEquals(errorLabel({ message: 'obj' }), 'non-Error thrown (object)')
})

Deno.test('errorLabel — never contains the error message (the PII channel)', () => {
  const secret = 'user task title: buy surprise gift for Alex'
  const label = errorLabel(new Error(secret))
  assertEquals(label.includes('Alex'), false)
  assertStringIncludes(label, 'Error')
})
