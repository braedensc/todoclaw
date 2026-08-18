// Tests for the edge-side cadence ladder.
//
// Run: deno test --no-check supabase/functions/_shared/recurring-status.test.ts
//
// This is the Deno mirror of src/lib/recurring.ts, so the LABELS and THRESHOLDS asserted here must
// match src/lib/recurring.test.ts exactly — the two trees can't import from each other, so these
// literal expectations are the lockstep. Before this module the same ladder lived in THREE places
// and had already drifted ('due again in 4d' vs 'in 4d' for the same state).

import { assertEquals } from 'jsr:@std/assert@1'
import {
  recurringCompletion,
  recurringDoneToday,
  recurringRestore,
  recurringStatus,
} from './recurring-status.ts'

const TZ = 'America/New_York'
// 2026-06-23T00:00:00Z is 2026-06-22 20:00 in New York, so "today" there is the 22nd.
const NOW = new Date('2026-06-23T00:00:00Z')

Deno.test('recurringStatus: null for a non-recurring task', () => {
  assertEquals(recurringStatus(null, TZ, NOW), null)
  assertEquals(recurringStatus({ frequencyDays: 0 }, TZ, NOW), null)
})

Deno.test('recurringStatus: the cadence ladder, label for label', () => {
  const at = (frequencyDays: number, lastDoneAt: string) =>
    recurringStatus({ frequencyDays, lastDoneAt }, TZ, NOW)

  assertEquals(recurringStatus({ frequencyDays: 7, lastDoneAt: null }, TZ, NOW), {
    label: 'never done',
    code: 'overdue',
    daysLeft: -999,
  })
  // done 7d ago, cadence 5 → daysLeft -2
  assertEquals(at(5, '2026-06-16T00:00:00Z'), {
    label: 'overdue 2d',
    code: 'overdue',
    daysLeft: -2,
  })
  assertEquals(at(7, '2026-06-16T00:00:00Z'), { label: 'due today', code: 'due', daysLeft: 0 })
  assertEquals(at(8, '2026-06-16T00:00:00Z'), { label: 'due tomorrow', code: 'due', daysLeft: 1 })
  assertEquals(at(9, '2026-06-16T00:00:00Z'), { label: 'in 2d', code: 'soon', daysLeft: 2 })
  assertEquals(at(12, '2026-06-16T00:00:00Z'), { label: 'in 5d', code: 'soon', daysLeft: 5 })
  assertEquals(at(13, '2026-06-16T00:00:00Z'), { label: 'in 6d', code: 'ok', daysLeft: 6 })
})

// ---- nextDueOn: the one-shot occurrence override ------------------------------------------------
// "I need to do laundry tomorrow" on a chore whose cadence is nowhere near due.

// Monthly chore last done the 14th local → cadence ~22d out = 'ok' (hidden from the board).
const okCadence = (nextDueOn: string | null) => ({
  frequencyDays: 30,
  lastDoneAt: '2026-06-15T00:00:00Z',
  doneCount: 9,
  nextDueOn,
})

Deno.test('nextDueOn: an ok cadence is off the board until an override lands on today', () => {
  assertEquals(recurringStatus(okCadence(null), TZ, NOW)?.code, 'ok')
  assertEquals(recurringStatus(okCadence('2026-06-22'), TZ, NOW), {
    label: 'due today',
    code: 'due',
    daysLeft: 0,
  })
})

Deno.test('nextDueOn: reads as a heads-up the day before, and overdue once missed', () => {
  assertEquals(recurringStatus(okCadence('2026-06-23'), TZ, NOW)?.label, 'due tomorrow')
  assertEquals(recurringStatus(okCadence('2026-06-19'), TZ, NOW), {
    label: 'overdue 3d',
    code: 'overdue',
    daysLeft: -3,
  })
})

Deno.test('nextDueOn: a far-off override stays off the board', () => {
  assertEquals(recurringStatus(okCadence('2026-07-06'), TZ, NOW)?.code, 'ok')
})

Deno.test('nextDueOn: read in the USER timezone, not UTC', () => {
  // Same instant: still the 22nd in New York, already the 23rd in Berlin.
  const rec = okCadence('2026-06-23')
  assertEquals(recurringStatus(rec, TZ, NOW)?.daysLeft, 1)
  assertEquals(recurringStatus(rec, 'Europe/Berlin', NOW)?.daysLeft, 0)
})

Deno.test('nextDueOn: RETIRES at read time once a completion caught up with it', () => {
  // Belt-and-braces against a writer that forgets to clear the field — otherwise the chore would
  // read "due today" forever.
  const stale = {
    frequencyDays: 30,
    lastDoneAt: '2026-06-23T00:00:00Z', // 2026-06-22 local = the scheduled day
    doneCount: 9,
    nextDueOn: '2026-06-22',
  }
  assertEquals(recurringStatus(stale, TZ, NOW)?.code, 'ok') // cadence resumes
})

Deno.test('recurringDoneToday: keyed on the user-local calendar day', () => {
  const now = new Date('2026-06-23T15:00:00Z') // 11:00 local on the 23rd
  assertEquals(
    recurringDoneToday({ frequencyDays: 7, lastDoneAt: '2026-06-23T04:00:00Z' }, TZ, now),
    true,
  )
  // 03:59Z is still 23:59 local on the 22nd.
  assertEquals(
    recurringDoneToday({ frequencyDays: 7, lastDoneAt: '2026-06-23T03:59:00Z' }, TZ, now),
    false,
  )
  assertEquals(recurringDoneToday({ frequencyDays: 7, lastDoneAt: null }, TZ, now), false)
  assertEquals(recurringDoneToday(null, TZ, now), false)
})

Deno.test('recurringCompletion: real instant, one more done, override cleared', () => {
  const now = new Date('2026-06-23T15:00:00Z')
  const next = recurringCompletion(okCadence('2026-06-22'), now)
  // The cadence resumes from the REAL completion, so a one-off "do it Friday" never permanently
  // re-phases the user's rhythm.
  assertEquals(next.lastDoneAt, '2026-06-23T15:00:00.000Z')
  assertEquals(next.doneCount, 10)
  assertEquals(next.nextDueOn, null)
  assertEquals(next.frequencyDays, 30)
})

Deno.test('recurringRestore: pure one-cadence rewind, override cleared', () => {
  const back = recurringRestore({
    frequencyDays: 7,
    lastDoneAt: '2026-06-23T15:00:00Z',
    doneCount: 5,
    nextDueOn: '2026-06-22',
  })
  assertEquals(back?.lastDoneAt, '2026-06-16T15:00:00.000Z')
  assertEquals(back?.doneCount, 4)
  assertEquals(back?.nextDueOn, null)
  assertEquals(recurringRestore({ frequencyDays: 7, lastDoneAt: null }), null)
})
