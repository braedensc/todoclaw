import { describe, expect, it } from 'vitest'
import {
  dueChipStyle,
  fmtCountdown,
  fmtOverdueAmount,
  gridChipLabel,
  stalenessStyle,
  urgencyGlowStyle,
  urgencyTier,
} from './visual-urgency'

// These tests pin the 2026-07-08 workshop ladder — the DELIBERATE ~2× amplification of the
// original EisenClaw glow (its "much more obvious" ask) plus the time-of-day tiers. If a value
// changes, that is a visual-design decision — update the table in visual-urgency.ts AND the
// keyframes in index.css, not just the assertion. Staleness remains EisenClaw parity.

describe('urgencyTier', () => {
  it('null due → none; day boundaries land each tier', () => {
    expect(urgencyTier(null, null)).toBe('none')
    expect(urgencyTier(-1, null)).toBe('overdue')
    expect(urgencyTier(0, null)).toBe('today')
    expect(urgencyTier(1, null)).toBe('closing-in')
    expect(urgencyTier(2, null)).toBe('closing-in')
    expect(urgencyTier(3, null)).toBe('this-week')
    expect(urgencyTier(7, null)).toBe('this-week')
    expect(urgencyTier(8, null)).toBe('radar')
    expect(urgencyTier(14, null)).toBe('radar')
    expect(urgencyTier(15, null)).toBe('none')
  })

  it('a timed task flips to overdue when its instant passes, not at midnight', () => {
    expect(urgencyTier(0, -5)).toBe('overdue')
    // …but a future-dated task can never read overdue off a clock-skew minutes value.
    expect(urgencyTier(1, -5)).toBe('closing-in')
  })

  it('the final two hours of a timed task get their own tier', () => {
    expect(urgencyTier(0, 120)).toBe('final-hours')
    expect(urgencyTier(0, 45)).toBe('final-hours')
    expect(urgencyTier(0, 121)).toBe('today')
    // Date-only tasks have no instant → plain today.
    expect(urgencyTier(0, null)).toBe('today')
  })
})

describe('urgencyGlowStyle', () => {
  it('none → null', () => {
    expect(urgencyGlowStyle('none')).toBeNull()
  })

  it('overdue: strongest ring + pulse + warm card tint', () => {
    expect(urgencyGlowStyle('overdue')).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 4px rgba(194,105,63,1), 0 0 32px 12px rgba(194,105,63,0.6)',
      animation: 'urgency-pulse 2s ease-in-out infinite',
      background: '#fff8f3',
    })
  })

  it('final-hours: today ring + the soft pulse (no tint)', () => {
    expect(urgencyGlowStyle('final-hours')).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 3px rgba(194,105,63,0.92), 0 0 26px 10px rgba(194,105,63,0.5)',
      animation: 'urgency-pulse-soft 3s ease-in-out infinite',
    })
  })

  it('today / closing-in / this-week / radar: static rings, no pulse', () => {
    expect(urgencyGlowStyle('today')).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 3px rgba(194,105,63,0.92), 0 0 26px 10px rgba(194,105,63,0.5)',
    })
    expect(urgencyGlowStyle('closing-in')).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 3px rgba(184,134,42,0.8), 0 0 22px 8px rgba(184,134,42,0.42)',
    })
    expect(urgencyGlowStyle('this-week')).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 2.5px rgba(138,120,40,0.6), 0 0 18px 6px rgba(138,120,40,0.3)',
    })
    expect(urgencyGlowStyle('radar')).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 1.5px rgba(138,120,40,0.35), 0 0 14px 4px rgba(138,120,40,0.22)',
    })
  })
})

describe('dueChipStyle', () => {
  it('terracotta fill for the hot tiers, gold for closing-in, olive outline for this-week, muted otherwise', () => {
    const hot = { backgroundColor: '#c2693f', color: '#fff' }
    expect(dueChipStyle('overdue')).toEqual(hot)
    expect(dueChipStyle('final-hours')).toEqual(hot)
    expect(dueChipStyle('today')).toEqual(hot)
    expect(dueChipStyle('closing-in')).toEqual({ backgroundColor: '#b8862a', color: '#fff' })
    expect(dueChipStyle('this-week')).toEqual({
      backgroundColor: 'transparent',
      color: '#8a7828',
      border: '1.5px solid rgba(138,120,40,0.55)',
    })
    expect(dueChipStyle('radar')).toEqual({ backgroundColor: '#8a8577', color: '#fff' })
    expect(dueChipStyle('none')).toEqual({ backgroundColor: '#8a8577', color: '#fff' })
  })
})

describe('chip label helpers', () => {
  it('fmtCountdown: minutes, then h + m', () => {
    expect(fmtCountdown(45)).toBe('in 45m')
    expect(fmtCountdown(60)).toBe('in 1h')
    expect(fmtCountdown(80)).toBe('in 1h 20m')
    expect(fmtCountdown(0.4)).toBe('in 1m') // never "in 0m"
  })

  it('fmtOverdueAmount: hours for a timed task past its instant today, days otherwise', () => {
    expect(fmtOverdueAmount(0, -125)).toBe('2h')
    expect(fmtOverdueAmount(0, -30)).toBe('30m')
    expect(fmtOverdueAmount(-3, null)).toBe('3d')
    expect(fmtOverdueAmount(-3, -4000)).toBe('3d') // d < 0 → day-granular even when timed
  })

  it('gridChipLabel says WHEN by tier', () => {
    expect(gridChipLabel('overdue', 0, '15:00:00', -125)).toBe('Overdue · 2h')
    expect(gridChipLabel('overdue', -3, null, null)).toBe('Overdue · 3d')
    expect(gridChipLabel('final-hours', 0, '15:00:00', 45)).toBe('⏰ in 45m')
    expect(gridChipLabel('today', 0, '15:00:00', 300)).toBe('⏰ 3:00 PM')
    expect(gridChipLabel('today', 0, null, null)).toBe('Today')
    expect(gridChipLabel('closing-in', 1, '20:00:00', null)).toBe('Tomorrow 8:00 PM')
    expect(gridChipLabel('closing-in', 1, null, null)).toBe('Tomorrow')
    expect(gridChipLabel('closing-in', 2, null, null)).toBe('2d')
    expect(gridChipLabel('this-week', 5, null, null)).toBe('5d')
    expect(gridChipLabel('radar', 12, null, null)).toBe('12d')
  })
})

describe('stalenessStyle', () => {
  const NOW = new Date('2026-07-02T12:00:00Z')
  // Build a created_at that is exactly `days` old relative to NOW.
  const agedByDays = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

  it('returns null for a staged card regardless of age', () => {
    expect(stalenessStyle({ created_at: agedByDays(100), staged: true }, NOW)).toBeNull()
  })

  it('returns null when created_at is missing or unparseable', () => {
    expect(stalenessStyle({ created_at: null, staged: false }, NOW)).toBeNull()
    expect(stalenessStyle({ created_at: 'not-a-date', staged: false }, NOW)).toBeNull()
  })

  it('fresh (< 21d): no effect, including the boundary at 20 days', () => {
    expect(stalenessStyle({ created_at: agedByDays(0), staged: false }, NOW)).toBeNull()
    expect(stalenessStyle({ created_at: agedByDays(20), staged: false }, NOW)).toBeNull()
  })

  it('21–44d: saturate(0.8), opacity 0.90', () => {
    const expected = { filter: 'saturate(0.8)', opacity: 0.9 }
    expect(stalenessStyle({ created_at: agedByDays(21), staged: false }, NOW)).toEqual(expected)
    expect(stalenessStyle({ created_at: agedByDays(44), staged: false }, NOW)).toEqual(expected)
  })

  it('45–74d: saturate(0.55), opacity 0.82', () => {
    const expected = { filter: 'saturate(0.55)', opacity: 0.82 }
    expect(stalenessStyle({ created_at: agedByDays(45), staged: false }, NOW)).toEqual(expected)
    expect(stalenessStyle({ created_at: agedByDays(74), staged: false }, NOW)).toEqual(expected)
  })

  it('>= 75d: saturate(0.3), opacity 0.72', () => {
    const expected = { filter: 'saturate(0.3)', opacity: 0.72 }
    expect(stalenessStyle({ created_at: agedByDays(75), staged: false }, NOW)).toEqual(expected)
    expect(stalenessStyle({ created_at: agedByDays(365), staged: false }, NOW)).toEqual(expected)
  })
})
