import { describe, expect, it } from 'vitest'
import type { Recurring } from '../types/task'
import {
  RC_COLOR,
  fmtFrequency,
  recurringDoneToday,
  recurringDueLive,
  recurringStatus,
  recurringTaskStatus,
} from './recurring'

// Fix "now" and align lastDoneAt to the same instant so daysSince === 0; then
// daysLeft === frequencyDays, letting each frequency drive a specific threshold.
const NOW = new Date('2026-06-23T00:00:00Z')
const LAST = '2026-06-23T00:00:00Z'

function rec(overrides: Partial<Recurring> = {}): Recurring {
  return { frequencyDays: 7, lastDoneAt: LAST, doneCount: 0, ...overrides }
}

describe('recurringStatus', () => {
  it('returns null for a non-recurring task', () => {
    expect(recurringStatus(null, { now: NOW })).toBeNull()
    expect(recurringStatus(undefined, { now: NOW })).toBeNull()
    expect(recurringStatus(rec({ frequencyDays: 0 }), { now: NOW })).toBeNull()
  })

  it('treats a never-done recurring task as deeply overdue', () => {
    expect(recurringStatus(rec({ lastDoneAt: null }), { now: NOW })).toEqual({
      label: 'never done',
      code: 'overdue',
      daysLeft: -999,
    })
  })

  it('codes daysLeft < -1 as overdue with an absolute-days label', () => {
    // frequencyDays 5, done 7 days ago → daysSince 7, daysLeft -2.
    const status = recurringStatus(rec({ frequencyDays: 5, lastDoneAt: '2026-06-16T00:00:00Z' }), {
      now: NOW,
    })
    expect(status).toEqual({ label: 'overdue 2d', code: 'overdue', daysLeft: -2 })
  })

  it('codes daysLeft -1, 0, and 1 as due', () => {
    // daysLeft -1 → "due today" (label uses <= 0).
    expect(
      recurringStatus(rec({ frequencyDays: 6, lastDoneAt: '2026-06-16T00:00:00Z' }), { now: NOW }),
    ).toMatchObject({ code: 'due', daysLeft: -1, label: 'due today' })
    // daysLeft 0 → "due today".
    expect(
      recurringStatus(rec({ frequencyDays: 7, lastDoneAt: '2026-06-16T00:00:00Z' }), { now: NOW }),
    ).toMatchObject({ code: 'due', daysLeft: 0, label: 'due today' })
    // daysLeft 1 → "due tomorrow".
    expect(recurringStatus(rec({ frequencyDays: 1 }), { now: NOW })).toMatchObject({
      code: 'due',
      daysLeft: 1,
      label: 'due tomorrow',
    })
  })

  it('codes daysLeft 2..5 as soon', () => {
    expect(recurringStatus(rec({ frequencyDays: 2 }), { now: NOW })).toMatchObject({
      code: 'soon',
      daysLeft: 2,
      label: 'in 2d',
    })
    expect(recurringStatus(rec({ frequencyDays: 5 }), { now: NOW })).toMatchObject({
      code: 'soon',
      daysLeft: 5,
      label: 'in 5d',
    })
  })

  it('codes daysLeft 6+ as ok', () => {
    expect(recurringStatus(rec({ frequencyDays: 6 }), { now: NOW })).toMatchObject({
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

// The one-off due-date override (ADR 2026-07-29-recurring-due-override). Eastern in June is
// UTC-4, so 2026-06-23T15:00Z is 11:00 local on the 23rd — the calendar day every `due` below
// is measured against.
describe('recurringTaskStatus', () => {
  const tz = 'America/New_York'
  const now = new Date('2026-06-23T15:00:00Z')
  // Done at 09:00 local today → daysSince 0, so a weekly chore's cadence reads "in 7d" (code ok).
  const doneToday = rec({ frequencyDays: 7, lastDoneAt: '2026-06-23T13:00:00Z' })

  it('returns null for a non-recurring task, due date or not', () => {
    expect(recurringTaskStatus({ recurring: null, due: '2026-06-23' }, { timeZone: tz, now })).toBe(
      null,
    )
    expect(recurringTaskStatus({}, { timeZone: tz, now })).toBeNull()
  })

  it('falls back to the cadence clock when there is no due date', () => {
    expect(recurringTaskStatus({ recurring: doneToday, due: null }, { timeZone: tz, now })).toEqual(
      {
        label: 'in 7d',
        code: 'ok',
        daysLeft: 7,
      },
    )
  })

  // The reported bug: a weekly chore ticked off today, then given a due date of today because the
  // user needs it in today's plan. Cadence alone said "in 7d" and it stayed invisible.
  it('lets a nearer due date override the cadence', () => {
    expect(
      recurringTaskStatus({ recurring: doneToday, due: '2026-06-23' }, { timeZone: tz, now }),
    ).toEqual({ label: 'due today', code: 'due', daysLeft: 0 })
    expect(
      recurringTaskStatus({ recurring: doneToday, due: '2026-06-24' }, { timeZone: tz, now }),
    ).toEqual({ label: 'due tomorrow', code: 'due', daysLeft: 1 })
    expect(
      recurringTaskStatus({ recurring: doneToday, due: '2026-06-26' }, { timeZone: tz, now }),
    ).toEqual({ label: 'in 3d', code: 'soon', daysLeft: 3 })
  })

  it('reads a past due date as overdue', () => {
    expect(
      recurringTaskStatus({ recurring: doneToday, due: '2026-06-20' }, { timeZone: tz, now }),
    ).toEqual({ label: 'overdue 3d', code: 'overdue', daysLeft: -3 })
  })

  // The two clocks combine by taking the NEARER one — a far-out due date must never push a chore
  // that its own cadence already calls overdue out of sight.
  it('keeps the cadence when the due date is further away', () => {
    const overdue = rec({ frequencyDays: 5, lastDoneAt: '2026-06-16T13:00:00Z' })
    expect(
      recurringTaskStatus({ recurring: overdue, due: '2026-07-30' }, { timeZone: tz, now }),
    ).toEqual({ label: 'overdue 2d', code: 'overdue', daysLeft: -2 })
    // A never-done chore stays deeply overdue too.
    expect(
      recurringTaskStatus(
        { recurring: rec({ lastDoneAt: null }), due: '2026-06-30' },
        { timeZone: tz, now },
      ),
    ).toEqual({ label: 'never done', code: 'overdue', daysLeft: -999 })
  })

  it('reads the due date as a wall-clock day in the user timezone', () => {
    // 20:00 local on the 23rd — still the 23rd locally, though it is already the 24th in UTC.
    const lateEvening = new Date('2026-06-24T00:00:00Z')
    expect(
      recurringTaskStatus(
        { recurring: doneToday, due: '2026-06-23' },
        { timeZone: tz, now: lateEvening },
      ),
    ).toEqual({ label: 'due today', code: 'due', daysLeft: 0 })
  })
})

describe('recurringDueLive', () => {
  const tz = 'America/New_York'
  const now = new Date('2026-06-23T15:00:00Z')

  it('is true only for a recurring task whose due date has arrived or passed', () => {
    expect(recurringDueLive({ recurring: rec(), due: '2026-06-23' }, { timeZone: tz, now })).toBe(
      true,
    )
    expect(recurringDueLive({ recurring: rec(), due: '2026-06-01' }, { timeZone: tz, now })).toBe(
      true,
    )
    expect(recurringDueLive({ recurring: rec(), due: '2026-06-24' }, { timeZone: tz, now })).toBe(
      false,
    )
    expect(recurringDueLive({ recurring: rec(), due: null }, { timeZone: tz, now })).toBe(false)
  })

  it('is false for a non-recurring task (its due date is not an override)', () => {
    expect(recurringDueLive({ recurring: null, due: '2026-06-23' }, { timeZone: tz, now })).toBe(
      false,
    )
  })
})
