import { describe, expect, it } from 'vitest'
import { localDateInTZ } from './dates'

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
