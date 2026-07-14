import { describe, it, expect } from 'vitest'
import { kindLabel, proactiveDayLabel } from './message-format'

describe('kindLabel', () => {
  it('maps each proactive kind to a short label', () => {
    expect(kindLabel('plan')).toBe('Morning plan')
    expect(kindLabel('recap')).toBe('Evening recap')
    expect(kindLabel('reminder')).toBe('Reminder')
  })
})

describe('proactiveDayLabel', () => {
  it('day-stamps a plan and a recap (every weekday ends in "day")', () => {
    expect(proactiveDayLabel('plan', '2026-07-14')).toMatch(/^\w+day morning plan$/)
    expect(proactiveDayLabel('recap', '2026-07-14')).toMatch(/^\w+day evening recap$/)
  })

  it('returns null for reminders and for missing/invalid dates', () => {
    expect(proactiveDayLabel('reminder', '2026-07-14')).toBeNull()
    expect(proactiveDayLabel('plan', null)).toBeNull()
    expect(proactiveDayLabel('plan', undefined)).toBeNull()
    expect(proactiveDayLabel('plan', 'not-a-date')).toBeNull()
    expect(proactiveDayLabel(null, '2026-07-14')).toBeNull()
  })

  it('parses at local midnight, so the weekday does not slip a day west of UTC', () => {
    // A plain new Date('2026-07-01') is UTC-midnight → in a negative-offset zone it renders as
    // Jun 30 (Tuesday). The helper uses T00:00:00 (local), so it must read Wednesday for Jul 1 2026.
    expect(proactiveDayLabel('plan', '2026-07-01')).toBe('Wednesday morning plan')
  })
})
