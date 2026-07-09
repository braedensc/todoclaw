import { describe, expect, it } from 'vitest'
import { dueInstant, formatDueTime, localDateInTZ, reminderFireAt } from './dates'

describe('localDateInTZ', () => {
  it('returns the calendar date for the instant in the given timezone', () => {
    // 03:30 UTC is still the 22nd in New York (UTC-4 in June) but the 23rd in Tokyo (UTC+9).
    const instant = new Date('2026-06-23T03:30:00Z')
    expect(localDateInTZ('America/New_York', instant)).toBe('2026-06-22')
    expect(localDateInTZ('Asia/Tokyo', instant)).toBe('2026-06-23')
    expect(localDateInTZ('UTC', instant)).toBe('2026-06-23')
  })

  it('zero-pads month and day to a stable YYYY-MM-DD', () => {
    expect(localDateInTZ('UTC', new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05')
  })

  it('is correct across a US spring-forward DST transition', () => {
    // 06:30 UTC on 2026-03-08 is 01:30 local (still EST, pre-jump) — same calendar day.
    expect(localDateInTZ('America/New_York', new Date('2026-03-08T06:30:00Z'))).toBe('2026-03-08')
  })

  it('throws RangeError on an unrecognized timezone', () => {
    expect(() => localDateInTZ('Not/AZone', new Date('2026-06-23T00:00:00Z'))).toThrow(RangeError)
  })
})

describe('dueInstant', () => {
  it('projects a wall-clock date + time in the zone to the instant it names', () => {
    // 10:30 in New York is UTC-4 in July (EDT) and UTC-5 in January (EST).
    expect(dueInstant('2026-07-22', '10:30', 'America/New_York').toISOString()).toBe(
      '2026-07-22T14:30:00.000Z',
    )
    expect(dueInstant('2026-01-22', '10:30', 'America/New_York').toISOString()).toBe(
      '2026-01-22T15:30:00.000Z',
    )
    // East of UTC.
    expect(dueInstant('2026-07-22', '10:30', 'Asia/Tokyo').toISOString()).toBe(
      '2026-07-22T01:30:00.000Z',
    )
    expect(dueInstant('2026-07-22', '10:30', 'UTC').toISOString()).toBe('2026-07-22T10:30:00.000Z')
  })

  it("accepts the Postgres `time` wire format 'HH:MM:SS'", () => {
    expect(dueInstant('2026-07-22', '10:30:00', 'America/New_York').toISOString()).toBe(
      '2026-07-22T14:30:00.000Z',
    )
  })

  it('resolves a nonexistent spring-forward time deterministically', () => {
    // 02:30 on 2026-03-08 does not exist in New York (clocks jump 02:00 EST → 03:00 EDT).
    // The two-pass correction settles one hour before the requested wall time (01:30 EST).
    expect(dueInstant('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T06:30:00.000Z',
    )
  })

  it('resolves an ambiguous fall-back time to its first occurrence', () => {
    // 01:30 on 2026-11-01 happens twice in New York (EDT, then again EST). First = EDT (-4).
    expect(dueInstant('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    )
  })

  it('throws RangeError on unparseable inputs', () => {
    expect(() => dueInstant('not-a-date', '10:30', 'UTC')).toThrow(RangeError)
    expect(() => dueInstant('2026-07-22', 'later', 'UTC')).toThrow(RangeError)
  })
})

describe('formatDueTime', () => {
  it("formats 'HH:MM' and the Postgres wire 'HH:MM:SS' identically (host locale)", () => {
    // Locale-proof: assert against the same Intl formatter the function must reduce to,
    // so the test pins behavior (a plain wall-clock reading) without pinning a locale.
    const expected = new Date(2000, 0, 1, 15, 0).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
    expect(formatDueTime('15:00')).toBe(expected)
    expect(formatDueTime('15:00:00')).toBe(expected)
    expect(formatDueTime('15:00')).not.toBe('')
  })

  it('returns empty string for unparseable input', () => {
    expect(formatDueTime('later')).toBe('')
    expect(formatDueTime('')).toBe('')
  })
})

describe('reminderFireAt', () => {
  it('subtracts the offset from the wall-clock due instant', () => {
    // 10:30 NY in July (EDT, UTC-4) = 14:30Z; 60 min before = 13:30Z.
    expect(reminderFireAt('2026-07-22', '10:30', 60, 'America/New_York').toISOString()).toBe(
      '2026-07-22T13:30:00.000Z',
    )
    // offset 0 = at the due instant.
    expect(reminderFireAt('2026-07-22', '10:30', 0, 'America/New_York').toISOString()).toBe(
      '2026-07-22T14:30:00.000Z',
    )
    // A full day before.
    expect(reminderFireAt('2026-07-22', '10:30', 1440, 'America/New_York').toISOString()).toBe(
      '2026-07-21T14:30:00.000Z',
    )
  })

  it('accepts a full ISO due (slices the date) and the HH:MM:SS wire time', () => {
    expect(
      reminderFireAt('2026-07-22T00:00:00Z', '10:30:00', 60, 'America/New_York').toISOString(),
    ).toBe('2026-07-22T13:30:00.000Z')
  })
})
