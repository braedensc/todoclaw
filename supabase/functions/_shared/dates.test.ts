// Verifies the localDateInTZ port stays identical to src/lib/dates.ts (same fixtures as
// src/lib/dates.test.ts). Run: deno test --no-check supabase/functions/_shared/dates.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { daysUntilInTZ, localDateInTZ } from './dates.ts'

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

// daysUntilInTZ — same fixtures as src/lib/scoring.test.ts daysUntil (incl. the #178
// floating-date regression: a bare 'YYYY-MM-DD' — the tasks.due DATE wire format — must not be
// parsed as a UTC instant, which reads as the previous local day west of UTC).
Deno.test('daysUntilInTZ treats a bare date-only due as a floating calendar date', () => {
  const nyNow = new Date('2026-06-23T14:00:00Z') // 10am on the 23rd in New York
  assertEquals(daysUntilInTZ('2026-06-23', 'America/New_York', nyNow), 0)
  assertEquals(daysUntilInTZ('2026-06-24', 'America/New_York', nyNow), 1)
  // Overdue only the day AFTER the due date.
  assertEquals(daysUntilInTZ('2026-06-22', 'America/New_York', nyNow), -1)
  // Same floating date is due-today regardless of the user's zone.
  assertEquals(daysUntilInTZ('2026-06-23', 'Asia/Tokyo', nyNow), 0)
})

Deno.test('daysUntilInTZ projects a due WITH a time component into the zone as an instant', () => {
  const nyNow = new Date('2026-06-23T14:00:00Z')
  // 03:30 UTC on the 24th is still the 23rd in New York → due today there, tomorrow in Tokyo.
  assertEquals(daysUntilInTZ('2026-06-24T03:30:00Z', 'America/New_York', nyNow), 0)
  assertEquals(daysUntilInTZ('2026-06-24T03:30:00Z', 'Asia/Tokyo', nyNow), 1)
})

Deno.test('daysUntilInTZ returns null for no due date', () => {
  assertEquals(daysUntilInTZ(null, 'UTC', new Date('2026-06-23T14:00:00Z')), null)
})
