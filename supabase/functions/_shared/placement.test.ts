// Exhaustive tests for the due → x/y/staged auto-placement table (Discrepancy #5).
// Run: deno test --no-check supabase/functions/_shared/placement.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { placeByDue, urgencyToX, importanceToY } from './placement.ts'

const TZ = 'America/New_York'
// Use a noon-UTC "now" and noon-UTC due dates so the local-date collapse is unambiguous.
const NOW = new Date('2026-06-24T16:00:00.000Z') // 12:00 EDT, Wed Jun 24

function x(dueDaysFromNow: number): number {
  const due = new Date(NOW.getTime() + dueDaysFromNow * 86_400_000).toISOString()
  return placeByDue(due, TZ, NOW).x
}

Deno.test('no due date → staged at center', () => {
  assertEquals(placeByDue(null, TZ, NOW), { x: 0.5, y: 0.5, staged: true })
})

Deno.test('a due date places on the grid with importance 0.75', () => {
  const p = placeByDue('2026-07-01T16:00:00.000Z', TZ, NOW)
  assertEquals(p.y, 0.75)
  assertEquals(p.staged, false)
})

Deno.test('urgency (x) by days-until-due — every bucket boundary', () => {
  assertEquals(x(-3), 0.9) // overdue
  assertEquals(x(0), 0.9) // today
  assertEquals(x(1), 0.84) // 1–2 days
  assertEquals(x(2), 0.84)
  assertEquals(x(3), 0.7) // 3–7 days
  assertEquals(x(7), 0.7)
  assertEquals(x(8), 0.55) // 1–2 weeks
  assertEquals(x(14), 0.55)
  assertEquals(x(15), 0.32) // 2–4 weeks
  assertEquals(x(28), 0.32)
  assertEquals(x(29), 0.18) // 1–3 months
  assertEquals(x(120), 0.18) // beyond 3 months → still low urgency
})

Deno.test(
  'a bare YYYY-MM-DD due (the tasks.due DATE wire format) is a floating calendar date',
  () => {
    // Regression (#178, server side): parsed as a UTC instant, '2026-06-25' would read as the
    // 24th in New York — "today" — and place at 0.9 instead of 0.84.
    assertEquals(placeByDue('2026-06-25', TZ, NOW).x, 0.84) // tomorrow
    assertEquals(placeByDue('2026-06-24', TZ, NOW).x, 0.9) // today
    assertEquals(placeByDue('2026-07-01', TZ, NOW).x, 0.7) // 7 days out
  },
)

Deno.test('word → coordinate mappings', () => {
  assertEquals(urgencyToX('high'), 0.84)
  assertEquals(urgencyToX('medium'), 0.55)
  assertEquals(urgencyToX('low'), 0.18)
  assertEquals(importanceToY('high'), 0.75)
  assertEquals(importanceToY('low'), 0.5)
})
