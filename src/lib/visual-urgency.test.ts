import { describe, expect, it } from 'vitest'
import { stalenessStyle, urgencyGlowStyle } from './visual-urgency'

// These tests pin the ported EisenClaw constants (LOGIC-TO-PORT §4/§5, html:77-95). If a value
// changes, that is a deliberate visual-parity decision — update the table AND the doc, not just
// the assertion.

describe('urgencyGlowStyle', () => {
  it('returns null when there is no due date', () => {
    expect(urgencyGlowStyle(null)).toBeNull()
  })

  it('overdue (d < 0): strongest ring + 14px glow + pulse animation', () => {
    const glow = urgencyGlowStyle(-1)
    expect(glow).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 2px rgba(194,105,63,0.60), 0 0 14px 5px rgba(194,105,63,0.28)',
      animation: 'urgency-pulse 2s ease-in-out infinite',
    })
  })

  it('only the overdue tier pulses', () => {
    expect(urgencyGlowStyle(-30)?.animation).toBe('urgency-pulse 2s ease-in-out infinite')
    for (const d of [0, 1, 2, 7, 14]) {
      expect(urgencyGlowStyle(d)?.animation).toBeUndefined()
    }
  })

  it('due today (d === 0): ring + 12px glow, no pulse', () => {
    expect(urgencyGlowStyle(0)).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 1.5px rgba(194,105,63,0.50), 0 0 12px 4px rgba(194,105,63,0.20)',
    })
  })

  it('d <= 2 (boundary at 1 and 2): gold ring + 10px glow', () => {
    const expected = {
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 1.5px rgba(184,134,42,0.45), 0 0 10px 3px rgba(184,134,42,0.16)',
    }
    expect(urgencyGlowStyle(1)).toEqual(expected)
    expect(urgencyGlowStyle(2)).toEqual(expected)
  })

  it('d <= 7 (boundary at 3 and 7): dim ring + 8px glow', () => {
    const expected = {
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 1px rgba(138,120,40,0.28), 0 0 8px 2px rgba(138,120,40,0.10)',
    }
    expect(urgencyGlowStyle(3)).toEqual(expected)
    expect(urgencyGlowStyle(7)).toEqual(expected)
  })

  it('d <= 14 (boundary at 8 and 14): subtle 5px glow only', () => {
    const expected = { boxShadow: '0 2px 7px rgba(0,0,0,.08), 0 0 5px 1px rgba(138,120,40,0.09)' }
    expect(urgencyGlowStyle(8)).toEqual(expected)
    expect(urgencyGlowStyle(14)).toEqual(expected)
  })

  it('d > 14: no glow', () => {
    expect(urgencyGlowStyle(15)).toBeNull()
    expect(urgencyGlowStyle(100)).toBeNull()
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
