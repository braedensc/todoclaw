// Verifies the workRecency port stays identical to src/lib/worked.ts (same fixtures as
// src/lib/worked.test.ts). If these two ever disagree, a card would show one thing while the
// planner and BabyClaw were told another about the very same project.
// Run: deno test --no-check supabase/functions/_shared/worked.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { WORKED_DAYS_CAP, workRecency, workedPhrase } from './worked.ts'

const TZ = 'America/New_York'
// Same fixture instant as src/lib/worked.test.ts: 2026-07-16 21:30 in New York, already the 17th
// in UTC — the case that catches a "UTC today" slip.
const NOW = new Date('2026-07-17T01:30:00Z')

const ongoing = (worked_days: string[] | null) => ({ ongoing: true, worked_days })

Deno.test('is null for a task that is not an ongoing project', () => {
  assertEquals(workRecency({ ongoing: false, worked_days: ['2026-07-16'] }, TZ, NOW), null)
  assertEquals(workRecency({}, TZ, NOW), null)
})

Deno.test('reports a never-worked project with a null age, not zero', () => {
  assertEquals(workRecency(ongoing(null), TZ, NOW), {
    lastWorked: null,
    daysSince: null,
    streak: 0,
    workedToday: false,
    sessions: 0,
  })
})

Deno.test("resolves 'today' in the user's zone, not UTC", () => {
  assertEquals(workRecency(ongoing(['2026-07-16']), TZ, NOW)?.workedToday, true)
  assertEquals(workRecency(ongoing(['2026-07-16']), 'UTC', NOW)?.workedToday, false)
  assertEquals(workRecency(ongoing(['2026-07-16']), 'UTC', NOW)?.daysSince, 1)
})

Deno.test('counts a run of consecutive days ending at the last session', () => {
  const r = workRecency(ongoing(['2026-07-16', '2026-07-15', '2026-07-14']), TZ, NOW)
  assertEquals(r?.streak, 3)
  assertEquals(r?.daysSince, 0)
})

Deno.test('stops the run at the first gap', () => {
  const r = workRecency(ongoing(['2026-07-16', '2026-07-15', '2026-07-12']), TZ, NOW)
  assertEquals(r?.streak, 2)
  assertEquals(r?.sessions, 3)
})

Deno.test('measures the run from the last session, not from today', () => {
  const r = workRecency(ongoing(['2026-07-09', '2026-07-08', '2026-07-07']), TZ, NOW)
  assertEquals(r?.streak, 3)
  assertEquals(r?.daysSince, 7)
})

Deno.test('normalizes an untrusted array: dedupe, re-sort, drop malformed', () => {
  // '2026-13-99' matches the YYYY-MM-DD shape and Date.UTC rolls it into a real instant, where it
  // would sort FIRST and be read as the newest session — it must be rejected outright.
  const r = workRecency(
    ongoing(['2026-07-14', '2026-07-16', '2026-07-15', '2026-07-16', '2026-13-99', 'nope']),
    TZ,
    NOW,
  )
  assertEquals(r?.lastWorked, '2026-07-16')
  assertEquals(r?.streak, 3)
  assertEquals(r?.sessions, 3)
})

Deno.test('clamps a future-dated session to today rather than going negative', () => {
  assertEquals(workRecency(ongoing(['2026-07-18']), TZ, NOW)?.daysSince, 0)
})

Deno.test('workedPhrase states raw facts and nothing else', () => {
  assertEquals(workedPhrase(workRecency(ongoing([]), TZ, NOW)), '')
  assertEquals(workedPhrase(null), '')
  assertEquals(workedPhrase(workRecency(ongoing(['2026-07-16']), TZ, NOW)), 'worked today')
  assertEquals(workedPhrase(workRecency(ongoing(['2026-07-15']), TZ, NOW)), 'worked yesterday')
  assertEquals(
    workedPhrase(workRecency(ongoing(['2026-07-11']), TZ, NOW)),
    'last worked 5 days ago',
  )
  assertEquals(
    workedPhrase(workRecency(ongoing(['2026-07-16', '2026-07-15', '2026-07-14']), TZ, NOW)),
    'worked today, 3 days running',
  )
})

Deno.test('workedPhrase carries no verdict vocabulary and no scolding', () => {
  // The pacing must stay varied and human, which it cannot do if the model is handed a state word
  // it can switch on. And a long gap is normal use of an ongoing project, never a failing.
  const phrases = [
    workedPhrase(workRecency(ongoing(['2026-07-16']), TZ, NOW)),
    workedPhrase(workRecency(ongoing(['2026-07-15']), TZ, NOW)),
    workedPhrase(workRecency(ongoing(['2026-05-01']), TZ, NOW)),
  ]
  for (const phrase of phrases) {
    for (const banned of [
      'resting',
      'cooling',
      'fresh',
      'due for',
      'neglect',
      'overdue',
      'stale',
    ]) {
      assertEquals(phrase.includes(banned), false, `"${phrase}" must not contain "${banned}"`)
    }
  }
})

Deno.test('the cap matches the client constant and the DB CHECK', () => {
  // src/lib/worked.ts WORKED_DAYS_CAP, this file, and tasks_worked_days_len must agree.
  assertEquals(WORKED_DAYS_CAP, 14)
})
