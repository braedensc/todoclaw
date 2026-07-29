// Deno tests for the occurrence-phasing math. The contract that matters is end-to-end: after
// scheduling a chore for day D, the SAME recurringStatus ladder every surface reads must call it
// "due today" throughout D — and "due tomorrow", never "ok", on the day before. So these tests
// re-implement that ladder verbatim from src/lib/recurring.ts and assert against it, rather than
// checking the returned timestamp against a hand-computed constant.
// Run: deno test --no-check supabase/functions/_shared/recurring-schedule.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { lastDoneAtForOccurrenceOn } from './recurring-schedule.ts'
import { startOfLocalDayInstant } from './dates.ts'

const MS_PER_DAY = 86_400_000

// Verbatim mirror of src/lib/recurring.ts recurringStatus (cadence half) — the oracle.
function label(lastDoneAt: string, frequencyDays: number, now: Date): string {
  const daysSince = Math.floor((now.getTime() - Date.parse(lastDoneAt)) / MS_PER_DAY)
  const daysLeft = frequencyDays - daysSince
  if (daysLeft < -1) return `overdue ${Math.abs(daysLeft)}d`
  if (daysLeft <= 1) return daysLeft <= 0 ? 'due today' : 'due tomorrow'
  if (daysLeft <= 5) return `in ${daysLeft}d`
  return `in ${daysLeft}d` // code 'ok' above 5 — the state that hides a chore from the board
}

// Sample a wall-clock day at its first instant, mid-morning, and its last second.
function readingsAcross(date: string, tz: string, lastDoneAt: string, freq: number): string[] {
  const start = startOfLocalDayInstant(date, tz).getTime()
  return [0, 10 * 3_600_000, MS_PER_DAY - 1000].map((offset) =>
    label(lastDoneAt, freq, new Date(start + offset)),
  )
}

Deno.test('a weekly chore scheduled for a day reads "due today" all through that day', () => {
  const tz = 'America/New_York'
  const lastDoneAt = lastDoneAtForOccurrenceOn('2026-07-30', 7, tz)
  assertEquals(readingsAcross('2026-07-30', tz, lastDoneAt, 7), [
    'due today',
    'due today',
    'due today',
  ])
})

Deno.test('the day before reads "due tomorrow" — visible, never the hidden "ok" state', () => {
  const tz = 'America/New_York'
  const lastDoneAt = lastDoneAtForOccurrenceOn('2026-07-30', 7, tz)
  assertEquals(readingsAcross('2026-07-29', tz, lastDoneAt, 7), [
    'due tomorrow',
    'due tomorrow',
    'due tomorrow',
  ])
})

Deno.test('two days before is still "in 2d" — the chore is not dragged forward early', () => {
  const tz = 'America/New_York'
  const lastDoneAt = lastDoneAtForOccurrenceOn('2026-07-30', 7, tz)
  assertEquals(readingsAcross('2026-07-28', tz, lastDoneAt, 7), ['in 2d', 'in 2d', 'in 2d'])
})

// Miss the day and it keeps nagging: the ladder reads daysLeft -1 as "due today" (so a skipped
// chore lingers one more day rather than silently resetting), then tips into overdue.
Deno.test('a missed scheduled day keeps the chore surfaced, then goes overdue', () => {
  const tz = 'America/New_York'
  const lastDoneAt = lastDoneAtForOccurrenceOn('2026-07-30', 7, tz)
  assertEquals(readingsAcross('2026-07-31', tz, lastDoneAt, 7)[1], 'due today')
  assertEquals(readingsAcross('2026-08-01', tz, lastDoneAt, 7)[1], 'overdue 2d')
})

Deno.test('holds across every cadence, including a daily chore', () => {
  const tz = 'America/New_York'
  for (const freq of [1, 2, 3, 7, 14, 30, 90]) {
    const lastDoneAt = lastDoneAtForOccurrenceOn('2026-07-30', freq, tz)
    assertEquals(
      readingsAcross('2026-07-30', tz, lastDoneAt, freq),
      ['due today', 'due today', 'due today'],
      `cadence ${freq}`,
    )
  }
})

// The whole point of phasing off local midnight rather than a UTC date: a zone far from UTC in
// either direction must still read "due today" from its own midnight, not hours late or early.
Deno.test('lands on the right local day in zones on both sides of UTC', () => {
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Honolulu', 'Asia/Kolkata', 'Europe/London']) {
    const lastDoneAt = lastDoneAtForOccurrenceOn('2026-07-30', 7, tz)
    assertEquals(
      readingsAcross('2026-07-30', tz, lastDoneAt, 7),
      ['due today', 'due today', 'due today'],
      tz,
    )
    assertEquals(readingsAcross('2026-07-29', tz, lastDoneAt, 7)[1], 'due tomorrow', tz)
  }
})

// A 23-hour spring-forward day and a 25-hour fall-back day both sit inside the scheduled window.
Deno.test('survives a DST transition on the scheduled day', () => {
  const tz = 'America/New_York'
  for (const date of ['2027-03-14', '2027-11-07']) {
    const lastDoneAt = lastDoneAtForOccurrenceOn(date, 7, tz)
    assertEquals(
      readingsAcross(date, tz, lastDoneAt, 7),
      ['due today', 'due today', 'due today'],
      date,
    )
  }
})

Deno.test('a nonsense cadence is clamped rather than producing an invalid instant', () => {
  const tz = 'America/New_York'
  for (const freq of [0, -5, Number.NaN]) {
    const iso = lastDoneAtForOccurrenceOn('2026-07-30', freq, tz)
    assertEquals(Number.isNaN(Date.parse(iso)), false, String(freq))
    assertEquals(readingsAcross('2026-07-30', tz, iso, 1)[1], 'due today', String(freq))
  }
})
