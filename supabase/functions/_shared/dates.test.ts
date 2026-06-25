// Verifies the localDateInTZ port stays identical to src/lib/dates.ts (same fixtures as
// src/lib/dates.test.ts). Run: deno test --no-check supabase/functions/_shared/dates.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { localDateInTZ } from './dates.ts'

Deno.test('collapses an instant to the calendar date in the given timezone', () => {
  // 2026-06-24T02:00:00Z is still 2026-06-23 (22:00) in New York.
  const instant = new Date('2026-06-24T02:00:00.000Z')
  assertEquals(localDateInTZ('America/New_York', instant), '2026-06-23')
  assertEquals(localDateInTZ('UTC', instant), '2026-06-24')
  // ...and already 2026-06-24 (11:00) in Tokyo.
  assertEquals(localDateInTZ('Asia/Tokyo', instant), '2026-06-24')
})

Deno.test('formats single-digit month/day with leading zeros', () => {
  assertEquals(localDateInTZ('UTC', new Date('2026-01-05T12:00:00.000Z')), '2026-01-05')
})
