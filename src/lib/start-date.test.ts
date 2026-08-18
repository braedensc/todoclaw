import { describe, expect, it } from 'vitest'
import { formatStartDay, isDormant, pauseClearsDue } from './start-date'

// The dormancy predicate is the client half of a rule enforced in four places (SQL reminder
// sweep, dispatch RPC, edge plan-inputs/chat-context, and here) — these tests pin the boundary
// semantics (strictly-after, timezone-aware) the others mirror.

const TZ = 'America/New_York'
// 2026-07-17 01:30 UTC = 2026-07-16 21:30 in New York — a date-line-ish instant that catches
// any "UTC today" slip: the user's today is the 16th while UTC already says the 17th.
const NOW = new Date('2026-07-17T01:30:00Z')

describe('isDormant', () => {
  it('is false with no start date', () => {
    expect(isDormant({ start_date: null }, TZ, NOW)).toBe(false)
    expect(isDormant({}, TZ, NOW)).toBe(false)
  })

  it('is true strictly after today, false on today and in the past', () => {
    expect(isDormant({ start_date: '2026-07-17' }, TZ, NOW)).toBe(true) // tomorrow (NY)
    expect(isDormant({ start_date: '2026-08-01' }, TZ, NOW)).toBe(true)
    expect(isDormant({ start_date: '2026-07-16' }, TZ, NOW)).toBe(false) // today (NY) = live
    expect(isDormant({ start_date: '2026-07-01' }, TZ, NOW)).toBe(false)
  })

  it("computes 'today' in the USER's zone, not UTC", () => {
    // Same instant, UTC observer: the 17th IS today there, so the task is live.
    expect(isDormant({ start_date: '2026-07-17' }, 'UTC', NOW)).toBe(false)
    // Kiribati (UTC+14) is already on the 17th too.
    expect(isDormant({ start_date: '2026-07-17' }, 'Pacific/Kiritimati', NOW)).toBe(false)
  })

  it('tolerates a longer ISO string (slices the calendar day)', () => {
    expect(isDormant({ start_date: '2026-08-01T00:00:00Z' }, TZ, NOW)).toBe(true)
    expect(isDormant({ start_date: '2026-07-16T23:59:59Z' }, TZ, NOW)).toBe(false)
  })
})

// Pure string calendar comparison (no clock consulted, so fixed dates can't rot). The server
// twin lives in pause_task (_shared/capabilities/tasks.ts) — same strictly-before rule.
describe('pauseClearsDue', () => {
  it('clears only when the due day falls strictly BEFORE the resume day', () => {
    expect(pauseClearsDue({ due: '2026-07-10', recurring: null }, '2026-08-01')).toBe(true)
    // Due ON the resume day is kept: an event task wakes the morning it is due.
    expect(pauseClearsDue({ due: '2026-08-01', recurring: null }, '2026-08-01')).toBe(false)
    expect(pauseClearsDue({ due: '2026-08-02', recurring: null }, '2026-08-01')).toBe(false)
  })

  it('never clears without a due date, on resume (null), or on a recurring chore', () => {
    expect(pauseClearsDue({ due: null, recurring: null }, '2026-08-01')).toBe(false)
    expect(pauseClearsDue({ due: '2026-07-10', recurring: null }, null)).toBe(false)
    // A chore's due is only the reminder anchor — clearing it would wipe the reminder phase.
    expect(
      pauseClearsDue({ due: '2026-07-10', recurring: { frequencyDays: 7 } }, '2026-08-01'),
    ).toBe(false)
  })

  it('tolerates longer ISO strings (slices the calendar day)', () => {
    expect(pauseClearsDue({ due: '2026-07-10T09:00:00Z', recurring: null }, '2026-08-01')).toBe(
      true,
    )
  })
})

describe('formatStartDay', () => {
  it('formats the wall-clock day without timezone shift', () => {
    // en-US-ish hosts render "Aug 1"; assert the pieces so other host locales still pass.
    const label = formatStartDay('2026-08-01')
    expect(label).toContain('1')
    expect(label.toLowerCase()).toContain('aug')
  })

  it('returns empty for garbage', () => {
    expect(formatStartDay('not-a-date')).toBe('')
  })
})
