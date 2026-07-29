import { describe, expect, it } from 'vitest'
import type { Recurring } from '../types/task'
import {
  RC_COLOR,
  fmtFrequency,
  recurringCompletion,
  recurringDoneToday,
  recurringRestore,
  recurringStatus,
} from './recurring'

// Fix "now" and align lastDoneAt to the same instant so daysSince === 0; then
// daysLeft === frequencyDays, letting each frequency drive a specific threshold.
const TZ = 'America/New_York'
const NOW = new Date('2026-06-23T00:00:00Z')
const LAST = '2026-06-23T00:00:00Z'

function rec(overrides: Partial<Recurring> = {}): Recurring {
  return { frequencyDays: 7, lastDoneAt: LAST, doneCount: 0, ...overrides }
}

describe('recurringStatus', () => {
  it('returns null for a non-recurring task', () => {
    expect(recurringStatus(null, { timeZone: TZ, now: NOW })).toBeNull()
    expect(recurringStatus(undefined, { timeZone: TZ, now: NOW })).toBeNull()
    expect(recurringStatus(rec({ frequencyDays: 0 }), { timeZone: TZ, now: NOW })).toBeNull()
  })

  it('treats a never-done recurring task as deeply overdue', () => {
    expect(recurringStatus(rec({ lastDoneAt: null }), { timeZone: TZ, now: NOW })).toEqual({
      label: 'never done',
      code: 'overdue',
      daysLeft: -999,
    })
  })

  it('codes daysLeft < -1 as overdue with an absolute-days label', () => {
    // frequencyDays 5, done 7 days ago → daysSince 7, daysLeft -2.
    const status = recurringStatus(rec({ frequencyDays: 5, lastDoneAt: '2026-06-16T00:00:00Z' }), {
      timeZone: TZ,
      now: NOW,
    })
    expect(status).toEqual({ label: 'overdue 2d', code: 'overdue', daysLeft: -2 })
  })

  it('codes daysLeft -1, 0, and 1 as due', () => {
    // daysLeft -1 → "due today" (label uses <= 0).
    expect(
      recurringStatus(rec({ frequencyDays: 6, lastDoneAt: '2026-06-16T00:00:00Z' }), {
        timeZone: TZ,
        now: NOW,
      }),
    ).toMatchObject({ code: 'due', daysLeft: -1, label: 'due today' })
    // daysLeft 0 → "due today".
    expect(
      recurringStatus(rec({ frequencyDays: 7, lastDoneAt: '2026-06-16T00:00:00Z' }), {
        timeZone: TZ,
        now: NOW,
      }),
    ).toMatchObject({ code: 'due', daysLeft: 0, label: 'due today' })
    // daysLeft 1 → "due tomorrow".
    expect(recurringStatus(rec({ frequencyDays: 1 }), { timeZone: TZ, now: NOW })).toMatchObject({
      code: 'due',
      daysLeft: 1,
      label: 'due tomorrow',
    })
  })

  it('codes daysLeft 2..5 as soon', () => {
    expect(recurringStatus(rec({ frequencyDays: 2 }), { timeZone: TZ, now: NOW })).toMatchObject({
      code: 'soon',
      daysLeft: 2,
      label: 'in 2d',
    })
    expect(recurringStatus(rec({ frequencyDays: 5 }), { timeZone: TZ, now: NOW })).toMatchObject({
      code: 'soon',
      daysLeft: 5,
      label: 'in 5d',
    })
  })

  it('codes daysLeft 6+ as ok', () => {
    expect(recurringStatus(rec({ frequencyDays: 6 }), { timeZone: TZ, now: NOW })).toMatchObject({
      code: 'ok',
      daysLeft: 6,
      label: 'in 6d',
    })
  })
})

describe('RC_COLOR', () => {
  it('maps each code to its exact color', () => {
    expect(RC_COLOR).toEqual({
      overdue: '#c2693f',
      due: '#b8862a',
      soon: '#8a7828',
      ok: '#5b8a72',
    })
  })
})

describe('recurringDoneToday', () => {
  // Eastern (UTC-4 in June): the local day boundary is 04:00Z. A completion timestamped just after
  // that boundary is "today"; one just before it belongs to the previous local day.
  const tz = 'America/New_York'
  const now = new Date('2026-06-23T15:00:00Z') // 11:00 local on 2026-06-23

  it('is true when lastDoneAt falls on the current local day', () => {
    expect(recurringDoneToday(rec({ lastDoneAt: '2026-06-23T09:00:00Z' }), tz, now)).toBe(true)
    // Earliest instant still on the local day (00:00 local = 04:00Z).
    expect(recurringDoneToday(rec({ lastDoneAt: '2026-06-23T04:00:00Z' }), tz, now)).toBe(true)
  })

  it('is false for a completion on the previous local day (next-day case → task returns)', () => {
    // 03:59Z is still 23:59 local on 2026-06-22 — the previous local day.
    expect(recurringDoneToday(rec({ lastDoneAt: '2026-06-23T03:59:00Z' }), tz, now)).toBe(false)
    expect(recurringDoneToday(rec({ lastDoneAt: '2026-06-22T18:00:00Z' }), tz, now)).toBe(false)
  })

  it('is false for a never-done or non-recurring task', () => {
    expect(recurringDoneToday(rec({ lastDoneAt: null }), tz, now)).toBe(false)
    expect(recurringDoneToday(null, tz, now)).toBe(false)
  })
})

describe('fmtFrequency', () => {
  it('renders the cadence ladder', () => {
    expect(fmtFrequency(3)).toBe('every 3d')
    expect(fmtFrequency(7)).toBe('weekly')
    expect(fmtFrequency(10)).toBe('every 10d')
    expect(fmtFrequency(14)).toBe('every 2wk')
    expect(fmtFrequency(21)).toBe('every 3wk')
    expect(fmtFrequency(30)).toBe('monthly')
    expect(fmtFrequency(40)).toBe('every ~5wk')
    expect(fmtFrequency(60)).toBe('every ~2mo')
    expect(fmtFrequency(100)).toBe('every ~3mo')
  })

  it('honors the boundary values exactly', () => {
    expect(fmtFrequency(13)).toBe('every 13d')
    expect(fmtFrequency(32)).toBe('monthly')
    expect(fmtFrequency(42)).toBe('every ~5wk')
    expect(fmtFrequency(65)).toBe('every ~2mo')
    expect(fmtFrequency(66)).toBe('every ~3mo')
  })
})

// ---- nextDueOn: the one-shot occurrence override ------------------------------------------------
// The reported bug: "I need to do laundry tomorrow" on a weekly chore. Before this field, the only
// way to surface a chore on a chosen day was to overwrite `lastDoneAt` with a fabricated completion
// (target day minus one cadence) — a lie in the completion history that also re-phased the user's
// rhythm permanently. `nextDueOn` says the wanted day outright and is consumed by the next real
// completion. These pin that every part of that holds.
describe('recurringStatus with a nextDueOn override', () => {
  // NOW (2026-06-23T00:00:00Z) is 2026-06-22 20:00 in New York, so "today" there is the 22nd.
  // Monthly chore last done on the 14th local → cadence says ~22 days out, i.e. code 'ok': the
  // state that hides a chore from the grid entirely. This is the row the user was staring at.
  const okCadence = (nextDueOn: string | null): Recurring => ({
    frequencyDays: 30,
    lastDoneAt: '2026-06-15T00:00:00Z',
    doneCount: 9,
    nextDueOn,
  })

  it('is "ok" (off the board) on the cadence alone', () => {
    expect(recurringStatus(okCadence(null), { timeZone: TZ, now: NOW })?.code).toBe('ok')
  })

  it('reads "due today" when the override lands on today, overriding an ok cadence', () => {
    // NOW is 2026-06-23T00:00:00Z = 2026-06-22 20:00 in New York, so "today" is the 22nd there.
    const status = recurringStatus(okCadence('2026-06-22'), { timeZone: TZ, now: NOW })
    expect(status).toEqual({ label: 'due today', code: 'due', daysLeft: 0 })
  })

  it('reads "due tomorrow" the day before, so it lands on the board as a heads-up', () => {
    const status = recurringStatus(okCadence('2026-06-23'), { timeZone: TZ, now: NOW })
    expect(status).toEqual({ label: 'due tomorrow', code: 'due', daysLeft: 1 })
  })

  it('reads increasingly overdue when the scheduled day passes unfinished — self-healing, no cron', () => {
    const status = recurringStatus(okCadence('2026-06-19'), { timeZone: TZ, now: NOW })
    expect(status).toEqual({ label: 'overdue 3d', code: 'overdue', daysLeft: -3 })
  })

  it('stays OFF the board while the scheduled day is still far out', () => {
    // Scheduling a chore for next week must not clutter the board today: the same ladder that
    // hides an 'ok' cadence hides a far-off override.
    expect(recurringStatus(okCadence('2026-07-06'), { timeZone: TZ, now: NOW })?.code).toBe('ok')
  })

  it('is interpreted in the USER timezone, not UTC', () => {
    // Same instant, two zones. In New York it is still the 22nd; in Berlin it is already the 23rd.
    const rec = okCadence('2026-06-23')
    expect(recurringStatus(rec, { timeZone: TZ, now: NOW })?.daysLeft).toBe(1)
    expect(recurringStatus(rec, { timeZone: 'Europe/Berlin', now: NOW })?.daysLeft).toBe(0)
  })

  it('RETIRES at read time once a completion caught up with it', () => {
    // Belt-and-braces: every completion path clears the field, but a stale row (or a writer that
    // forgets) must not pin a chore to "due today" forever.
    const stale: Recurring = {
      frequencyDays: 7,
      lastDoneAt: '2026-06-23T00:00:00Z', // 2026-06-22 local — on the scheduled day
      doneCount: 9,
      nextDueOn: '2026-06-22',
    }
    expect(recurringStatus(stale, { timeZone: TZ, now: NOW })?.code).toBe('ok') // cadence resumes
  })

  it('still applies when the last completion predates the scheduled day', () => {
    const rec: Recurring = {
      frequencyDays: 30,
      lastDoneAt: '2026-06-10T00:00:00Z',
      doneCount: 2,
      nextDueOn: '2026-06-22',
    }
    expect(recurringStatus(rec, { timeZone: TZ, now: NOW })?.label).toBe('due today')
  })

  it('a never-done chore can still be scheduled onto a specific day', () => {
    const rec: Recurring = {
      frequencyDays: 7,
      lastDoneAt: null,
      doneCount: 0,
      nextDueOn: '2026-06-25',
    }
    // Without the override this reads 'never done' / deeply overdue; the override wins.
    expect(recurringStatus(rec, { timeZone: TZ, now: NOW })).toEqual({
      label: 'in 3d',
      code: 'soon',
      daysLeft: 3,
    })
  })
})

describe('recurringCompletion', () => {
  it('records the real completion instant and clears the override', () => {
    const now = new Date('2026-06-23T15:00:00Z')
    const next = recurringCompletion(
      {
        frequencyDays: 7,
        lastDoneAt: '2026-06-01T00:00:00Z',
        doneCount: 4,
        nextDueOn: '2026-06-22',
      },
      now,
    )
    // The cadence resumes from when the chore was ACTUALLY done, so a one-off "do it Friday" never
    // permanently moves the user's weekly rhythm.
    expect(next.lastDoneAt).toBe('2026-06-23T15:00:00.000Z')
    expect(next.doneCount).toBe(5)
    expect(next.nextDueOn).toBeNull()
    expect(next.frequencyDays).toBe(7)
  })
})

describe('recurringRestore', () => {
  it('rewinds the stamp by one cadence and clears the override', () => {
    const back = recurringRestore({
      frequencyDays: 7,
      lastDoneAt: '2026-06-23T15:00:00Z',
      doneCount: 5,
      nextDueOn: '2026-06-22',
    })
    expect(back?.lastDoneAt).toBe('2026-06-16T15:00:00.000Z')
    expect(back?.doneCount).toBe(4)
    expect(back?.nextDueOn).toBeNull()
  })

  it('reads "due today" when restored the same day it was completed', () => {
    const back = recurringRestore({
      frequencyDays: 7,
      lastDoneAt: '2026-06-23T00:00:00Z',
      doneCount: 5,
      nextDueOn: null,
    })
    expect(recurringStatus(back, { timeZone: TZ, now: NOW })?.label).toBe('due today')
  })

  it('returns null when there is nothing to undo', () => {
    expect(
      recurringRestore({ frequencyDays: 7, lastDoneAt: null, doneCount: 0, nextDueOn: null }),
    ).toBeNull()
  })
})
