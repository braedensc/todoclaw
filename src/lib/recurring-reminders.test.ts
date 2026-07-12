import { describe, expect, it } from 'vitest'
import { nextRecurringFireAt } from './recurring-reminders'

// A recurring reminder is the same offset model as a one-off — a lead time before the task's next
// occurrence — only the occurrence repeats on the cadence, phased off the anchor DUE date at DUE
// time, and re-arms each cycle regardless of completion. These pin the pure fire-time math (the TS
// mirror of the SQL next_recurring_fire_at). New York is UTC-4 (EDT) in July, UTC-5 (EST) in early
// March. Signature: (due 'YYYY-MM-DD', dueTime 'HH:MM', freqDays, offsetMinutes, tz, now).
const TZ = 'America/New_York'
const at = (iso: string) => new Date(iso)

describe('nextRecurringFireAt', () => {
  it('offset 0, daily: fires at the occurrence today when it is still ahead', () => {
    // now = 11:00 EDT; today's noon occurrence (16:00 UTC) is still ahead → fire at noon.
    const now = at('2026-07-11T15:00:00Z')
    expect(nextRecurringFireAt('2026-07-11', '12:00', 1, 0, TZ, now).toISOString()).toBe(
      '2026-07-11T16:00:00.000Z',
    )
  })

  it('offset 0, daily: rolls to the next occurrence once today has passed', () => {
    // now = 13:00 EDT; today's noon is gone → tomorrow at noon.
    const now = at('2026-07-11T17:00:00Z')
    expect(nextRecurringFireAt('2026-07-11', '12:00', 1, 0, TZ, now).toISOString()).toBe(
      '2026-07-12T16:00:00.000Z',
    )
  })

  it('offset 60: fires one hour before the occurrence', () => {
    // now = 10:00 EDT; today's noon lead time (11:00 EDT = 15:00 UTC) is still ahead → fire then.
    const now = at('2026-07-11T14:00:00Z')
    expect(nextRecurringFireAt('2026-07-11', '12:00', 1, 60, TZ, now).toISOString()).toBe(
      '2026-07-11T15:00:00.000Z',
    )
  })

  it('offset 60: arms the NEXT occurrence when the lead time has already elapsed (never fires late)', () => {
    // now = 11:30 EDT; today's 11:00 lead time is gone → tomorrow's 11:00 EDT (15:00 UTC).
    const now = at('2026-07-11T15:30:00Z')
    expect(nextRecurringFireAt('2026-07-11', '12:00', 1, 60, TZ, now).toISOString()).toBe(
      '2026-07-12T15:00:00.000Z',
    )
  })

  it('weekly cadence advances by 7 days, phased off the anchor day', () => {
    // Anchor Sat Jul 11 noon; now Jul 11 13:00 EDT → next is Sat Jul 18 noon, not the next day.
    const now = at('2026-07-11T17:00:00Z')
    expect(nextRecurringFireAt('2026-07-11', '12:00', 7, 0, TZ, now).toISOString()).toBe(
      '2026-07-18T16:00:00.000Z',
    )
  })

  it('a future anchor with a 1-day offset fires the day before the first occurrence', () => {
    // Anchor Jul 20 noon; "1 day before" → Jul 19 noon, which is ahead of Jul 11.
    const now = at('2026-07-11T17:00:00Z')
    expect(nextRecurringFireAt('2026-07-20', '12:00', 7, 1440, TZ, now).toISOString()).toBe(
      '2026-07-19T16:00:00.000Z',
    )
  })

  it('holds local noon across a US spring-forward DST transition', () => {
    // Anchor Mar 7 (EST); now Mar 7 12:01 EST (17:01 UTC). Today's noon has passed → Mar 8 (clocks
    // jump to EDT) noon = 16:00 UTC. A naive +24h would wrongly land at 17:00 UTC (1 PM local).
    const now = at('2026-03-07T17:01:00Z')
    const next = nextRecurringFireAt('2026-03-07', '12:00', 1, 0, TZ, now)
    expect(next.toISOString()).toBe('2026-03-08T16:00:00.000Z')
    expect(next.toISOString()).not.toBe('2026-03-08T17:00:00.000Z')
  })

  it('cron-outage skip: a far-past anchor yields the single next future slot, not the backlog', () => {
    // Anchor 10 days ago; now = 13:00 EDT today. It must jump straight to tomorrow's noon (today's
    // has passed) — fire ONCE, not once per missed day.
    const now = at('2026-07-11T17:00:00Z')
    expect(nextRecurringFireAt('2026-07-01', '12:00', 1, 0, TZ, now).toISOString()).toBe(
      '2026-07-12T16:00:00.000Z',
    )
  })

  it('a zero/garbage cadence is clamped to daily (never an infinite/degenerate loop)', () => {
    const now = at('2026-07-11T17:00:00Z')
    expect(nextRecurringFireAt('2026-07-11', '12:00', 0, 0, TZ, now).toISOString()).toBe(
      '2026-07-12T16:00:00.000Z',
    )
  })
})
