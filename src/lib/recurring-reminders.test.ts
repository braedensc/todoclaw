import { describe, expect, it } from 'vitest'
import { nextRecurringFireAt } from './recurring-reminders'

// A recurring reminder is a fixed-cadence alarm: fire at a wall-clock time on the cadence, every
// cycle, regardless of completion. These pin the pure fire-time math (the TS mirror of the SQL
// next_recurring_fire_at). New York is UTC-4 (EDT) in July, UTC-5 (EST) in early March.
const TZ = 'America/New_York'
const at = (iso: string) => new Date(iso)

describe('nextRecurringFireAt', () => {
  it('initial arm: fires today when the time is still ahead', () => {
    // now = 11:00 EDT; noon is still ahead → today at noon (16:00 UTC).
    const now = at('2026-07-11T15:00:00Z')
    const seed = at('2026-07-11T16:00:00Z') // "today at noon" seed
    expect(nextRecurringFireAt(seed, '12:00', 1, TZ, now).toISOString()).toBe(
      '2026-07-11T16:00:00.000Z',
    )
  })

  it('initial arm: rolls to the next cadence day when the time has passed', () => {
    // now = 13:00 EDT; today's noon is gone → tomorrow at noon.
    const now = at('2026-07-11T17:00:00Z')
    const seed = at('2026-07-11T16:00:00Z')
    expect(nextRecurringFireAt(seed, '12:00', 1, TZ, now).toISOString()).toBe(
      '2026-07-12T16:00:00.000Z',
    )
  })

  it('advances strictly forward by one day from a just-fired daily reminder', () => {
    // seed = the fire that just went off (≤ now) → the very next slot, never the same instant.
    const fired = at('2026-07-11T16:00:00Z')
    const now = at('2026-07-11T16:00:30Z')
    expect(nextRecurringFireAt(fired, '12:00', 1, TZ, now).toISOString()).toBe(
      '2026-07-12T16:00:00.000Z',
    )
  })

  it('weekly cadence advances by 7 days, phased off the seed day', () => {
    // Sat Jul 11 noon just fired → next is Sat Jul 18 noon, not the next calendar day.
    const fired = at('2026-07-11T16:00:00Z')
    const now = at('2026-07-11T16:00:30Z')
    expect(nextRecurringFireAt(fired, '12:00', 7, TZ, now).toISOString()).toBe(
      '2026-07-18T16:00:00.000Z',
    )
  })

  it('holds local noon across a US spring-forward DST transition', () => {
    // Mar 7 noon EST = 17:00 UTC; advance one day INTO EDT (Mar 8, clocks jump) → Mar 8 noon EDT =
    // 16:00 UTC. The instant shifts by the offset delta, but the wall clock stays noon — a naive
    // +24h would wrongly land at 17:00 UTC (1 PM local).
    const fired = at('2026-03-07T17:00:00Z')
    const now = at('2026-03-07T17:01:00Z')
    const next = nextRecurringFireAt(fired, '12:00', 1, TZ, now)
    expect(next.toISOString()).toBe('2026-03-08T16:00:00.000Z')
    expect(next.toISOString()).not.toBe('2026-03-08T17:00:00.000Z')
  })

  it('cron-outage skip: a far-past seed yields the single next future slot, not the backlog', () => {
    // Seed 10 days ago; now = 13:00 EDT today. It must jump straight to tomorrow's noon (today's
    // has passed) — fire ONCE, not once per missed day.
    const stale = at('2026-07-01T16:00:00Z')
    const now = at('2026-07-11T17:00:00Z')
    expect(nextRecurringFireAt(stale, '12:00', 1, TZ, now).toISOString()).toBe(
      '2026-07-12T16:00:00.000Z',
    )
  })

  it('a zero/garbage cadence is clamped to daily (never an infinite/degenerate loop)', () => {
    const fired = at('2026-07-11T16:00:00Z')
    const now = at('2026-07-11T16:00:30Z')
    expect(nextRecurringFireAt(fired, '12:00', 0, TZ, now).toISOString()).toBe(
      '2026-07-12T16:00:00.000Z',
    )
  })
})
