import { describe, expect, it } from 'vitest'
import {
  clusterStaleness,
  dueChipStyle,
  fmtAge,
  fmtCountdown,
  fmtOverdueAmount,
  gridChipLabel,
  PAUSED_OPACITY,
  pausedBadge,
  pausedChipLabel,
  pausedChipStyle,
  pausedRingStyle,
  staleBadge,
  staleChipStyle,
  staleness,
  staleRingStyle,
  urgencyGlowStyle,
  urgencyIcon,
  urgencyTier,
} from './visual-urgency'

// These tests pin the urgency ladder: the 2026-07-08 workshop tiers, the 2026-07-09 stronger
// rings/halos, and the two reinforcing channels added alongside them — the graduated card tint
// (urgencyGlowStyle.background) and the scarce hot-tier icon (urgencyIcon). If a value changes,
// that is a visual-design decision — update the table in visual-urgency.ts AND the keyframes in
// index.css, not just the assertion. The cool STALE lane (below) is the hot lane's off-ramp: a
// task ignored 3+ weeks past due (or undated + months old) flips from 🔥 to ❄️.

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
      background: '#fff1e8',
    })
  })

  it('final-hours: today ring + the soft pulse + tint', () => {
    expect(urgencyGlowStyle('final-hours')).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 3px rgba(194,105,63,0.92), 0 0 26px 10px rgba(194,105,63,0.5)',
      animation: 'urgency-pulse-soft 3s ease-in-out infinite',
      background: '#fff4ec',
    })
  })

  it('today / closing-in / this-week: static rings + graduated tint, no pulse', () => {
    expect(urgencyGlowStyle('today')).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 3px rgba(194,105,63,0.92), 0 0 26px 10px rgba(194,105,63,0.5)',
      background: '#fff7f0',
    })
    expect(urgencyGlowStyle('closing-in')).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 3px rgba(184,134,42,0.8), 0 0 22px 8px rgba(184,134,42,0.42)',
      background: '#fdf7ec',
    })
    expect(urgencyGlowStyle('this-week')).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 2.5px rgba(138,120,40,0.6), 0 0 18px 6px rgba(138,120,40,0.3)',
      background: '#faf7ee',
    })
  })

  it('radar: faintest ring, no tint (stays paper)', () => {
    expect(urgencyGlowStyle('radar')).toEqual({
      boxShadow:
        '0 2px 7px rgba(0,0,0,.08), 0 0 0 1.5px rgba(138,120,40,0.35), 0 0 14px 4px rgba(138,120,40,0.22)',
    })
  })
})

describe('urgencyIcon', () => {
  it('a scarce 🔥 flag on the hot (terracotta) tiers only', () => {
    expect(urgencyIcon('overdue')).toEqual({ glyph: '🔥', label: 'Overdue' })
    expect(urgencyIcon('final-hours')).toEqual({ glyph: '🔥', label: 'Due today' })
    expect(urgencyIcon('today')).toEqual({ glyph: '🔥', label: 'Due today' })
    // The softer tiers lean on the glow + tint + chip — no icon.
    expect(urgencyIcon('closing-in')).toBeNull()
    expect(urgencyIcon('this-week')).toBeNull()
    expect(urgencyIcon('radar')).toBeNull()
    expect(urgencyIcon('none')).toBeNull()
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

describe('staleness', () => {
  const NOW = new Date('2026-07-02T12:00:00Z')
  // Build a created_at that is exactly `days` old relative to NOW.
  const agedByDays = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()
  const fresh = { created_at: agedByDays(1), staged: false }

  it('a DATED task goes stale 21 days past due — measured from the due date, not created_at', () => {
    // Freshly created but long past due → stale (the amount is time past due).
    expect(staleness(fresh, -21, NOW)).toEqual({ days: 21, overdue: true, floor: 21 })
    expect(staleness(fresh, -100, NOW)).toEqual({ days: 100, overdue: true, floor: 21 })
  })

  it('a recently-overdue or future-dated task is NOT stale (the hot lane still owns it)', () => {
    const old = { created_at: agedByDays(400), staged: false }
    expect(staleness(old, -20, NOW)).toBeNull() // overdue, but under the 21d floor
    expect(staleness(old, 0, NOW)).toBeNull() // due today
    expect(staleness(old, 30, NOW)).toBeNull() // future-dated — scheduled, not ignored
  })

  it('an UNDATED task goes stale only after 90 days on the board (long-term ideas cool slowly)', () => {
    expect(staleness({ created_at: agedByDays(89), staged: false }, null, NOW)).toBeNull()
    expect(staleness({ created_at: agedByDays(90), staged: false }, null, NOW)).toEqual({
      days: 90,
      overdue: false,
      floor: 90,
    })
  })

  it('null for a staged card regardless of age or overdue amount', () => {
    expect(staleness({ created_at: agedByDays(200), staged: true }, null, NOW)).toBeNull()
    expect(staleness({ created_at: agedByDays(1), staged: true }, -50, NOW)).toBeNull()
  })

  it('null for an undated card with missing or unparseable created_at', () => {
    expect(staleness({ created_at: null, staged: false }, null, NOW)).toBeNull()
    expect(staleness({ created_at: 'not-a-date', staged: false }, null, NOW)).toBeNull()
  })

  // start_date (pause) interplay: dormancy isn't neglect, so the ignored-clock restarts at the
  // start date — a task that just woke from a pause can't be instantly ❄️.
  describe('with a start (pause) date', () => {
    // A wall-clock day exactly `days` before NOW (NOW sits at 12:00Z, so the arithmetic is exact).
    const dayAgedBy = (days: number) => agedByDays(days).slice(0, 10)

    it('a DATED task that recently (re)started is not stale despite a deep overdue count', () => {
      const wokeRecently = { created_at: agedByDays(400), staged: false, start_date: dayAgedBy(10) }
      expect(staleness(wokeRecently, -100, NOW)).toBeNull()
    })

    it('a DATED task stales again once it has a full floor of post-start board time', () => {
      const longAwake = { created_at: agedByDays(400), staged: false, start_date: dayAgedBy(21) }
      expect(staleness(longAwake, -100, NOW)).toEqual({ days: 100, overdue: true, floor: 21 })
    })

    it("an UNDATED task's board time counts from the start date, not created_at", () => {
      const base = { created_at: agedByDays(200), staged: false }
      expect(staleness({ ...base, start_date: dayAgedBy(30) }, null, NOW)).toBeNull()
      expect(staleness({ ...base, start_date: dayAgedBy(100) }, null, NOW)).toEqual({
        days: 100,
        overdue: false,
        floor: 90,
      })
    })

    it('a still-DORMANT task (future start) is never stale in either lane', () => {
      const dormant = { created_at: agedByDays(400), staged: false, start_date: dayAgedBy(-5) }
      expect(staleness(dormant, -100, NOW)).toBeNull()
      expect(staleness(dormant, null, NOW)).toBeNull()
    })
  })
})

describe('staleRingStyle', () => {
  // Depth ladder: rungs at 1×, 2×, 3× the floor — so 3/6/9 weeks past due hit the same rungs
  // as 3/6/9 months on the board.
  const overdueBy = (days: number) => ({ days, overdue: true, floor: 21 })
  const undatedFor = (days: number) => ({ days, overdue: false, floor: 90 })

  it('null when not stale', () => {
    expect(staleRingStyle(null)).toBeNull()
  })

  it('depth < 2×: thin cool-blue ring + faintest icy tint', () => {
    const expected = {
      boxShadow: '0 0 0 2px rgba(50,118,205,0.6), 0 0 14px 3px rgba(50,118,205,0.3)',
      background: '#f3f8fd',
    }
    expect(staleRingStyle(overdueBy(21))).toEqual(expected)
    expect(staleRingStyle(overdueBy(41))).toEqual(expected)
    expect(staleRingStyle(undatedFor(90))).toEqual(expected)
    expect(staleRingStyle(undatedFor(179))).toEqual(expected)
  })

  it('depth < 3×: medium cool-blue ring + icier tint', () => {
    const expected = {
      boxShadow: '0 0 0 2.5px rgba(50,118,205,0.78), 0 0 20px 5px rgba(50,118,205,0.42)',
      background: '#eaf3fc',
    }
    expect(staleRingStyle(overdueBy(42))).toEqual(expected)
    expect(staleRingStyle(overdueBy(62))).toEqual(expected)
    expect(staleRingStyle(undatedFor(180))).toEqual(expected)
  })

  it('depth >= 3×: thick cool-blue ring + brighter halo + iciest tint', () => {
    const expected = {
      boxShadow: '0 0 0 3px rgba(50,118,205,0.95), 0 0 28px 7px rgba(50,118,205,0.55)',
      background: '#e0edfb',
    }
    expect(staleRingStyle(overdueBy(63))).toEqual(expected)
    expect(staleRingStyle(overdueBy(365))).toEqual(expected)
    expect(staleRingStyle(undatedFor(270))).toEqual(expected)
  })
})

describe('clusterStaleness', () => {
  const NOW = new Date('2026-07-02T12:00:00Z')
  const agedByDays = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()
  // daysUntil is timezone-aware; UTC keeps the arithmetic exact for these fixtures.
  const opts = { timeZone: 'UTC', now: NOW }
  const dueDaysAgo = (days: number) =>
    new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10)
  interface Member {
    created_at: string | null
    staged: boolean
    due: string | null
    recurring: unknown
  }
  const member = (over: Partial<Member>): Member => ({
    created_at: agedByDays(1),
    staged: false,
    due: null,
    recurring: null,
    ...over,
  })

  it('takes the DEEPEST-stale member by depth (days/floor), across both stale kinds', () => {
    const group = [
      member({ due: dueDaysAgo(63) }), // 3× the overdue floor → depth 3
      member({ created_at: agedByDays(100) }), // undated at 100d → depth ~1.1
      member({ due: dueDaysAgo(2) }), // recently overdue → not stale
    ]
    // Depth 3 wins even though 100d > 63d in raw days.
    expect(clusterStaleness(group, opts, NOW)).toEqual({ days: 63, overdue: true, floor: 21 })
  })

  it('skips recurring members and returns null when nobody is stale', () => {
    expect(
      clusterStaleness(
        [member({ due: dueDaysAgo(400), recurring: { frequencyDays: 7 } }), member({})],
        opts,
        NOW,
      ),
    ).toBeNull()
  })
})

describe('fmtAge', () => {
  it('days up to a month, weeks to 10w, then months, then years', () => {
    expect(fmtAge(21)).toBe('21d')
    expect(fmtAge(29)).toBe('29d')
    expect(fmtAge(30)).toBe('4w')
    expect(fmtAge(44)).toBe('6w')
    expect(fmtAge(69)).toBe('10w')
    expect(fmtAge(70)).toBe('2mo')
    expect(fmtAge(90)).toBe('3mo')
    expect(fmtAge(364)).toBe('12mo')
    expect(fmtAge(365)).toBe('1y')
    expect(fmtAge(730)).toBe('2y')
  })
})

describe('staleBadge', () => {
  it('null when not stale', () => {
    expect(staleBadge(null)).toBeNull()
  })

  it('❄️ + compact amount + chip/title text for an ignored deadline', () => {
    expect(staleBadge({ days: 21, overdue: true, floor: 21 })).toEqual({
      glyph: '❄️',
      amount: '21d',
      chip: 'Stale · 21d',
      title: 'Stale — 21d past due',
    })
  })

  it('…and for an undated idea gone cold, the title says "on the board"', () => {
    expect(staleBadge({ days: 150, overdue: false, floor: 90 })).toEqual({
      glyph: '❄️',
      amount: '5mo',
      chip: 'Stale · 5mo',
      title: 'Stale — 5mo on the board',
    })
  })
})

describe('staleChipStyle', () => {
  it('solid azure fill (the cold-lane mirror of the terracotta overdue chip)', () => {
    expect(staleChipStyle()).toEqual({ backgroundColor: 'rgb(50,118,205)', color: '#fff' })
  })
})

// The PAUSED (dormant / future start_date) lane — a third, neutral SLATE dress a set-aside card
// wears, distinct from the warm urgency ladder, the cool stale azure, and the BabyClaw blue. Binary
// (no depth ladder): a task is paused or it isn't. Applied by the grid card / cluster row / Paused
// strip via these shared helpers so the surfaces can't drift.
describe('paused lane', () => {
  it('pausedRingStyle: a full-alpha slate ring + halo + slate tint (no depth ladder)', () => {
    expect(pausedRingStyle()).toEqual({
      boxShadow: '0 0 0 3px rgba(100,116,139,1), 0 0 24px 8px rgba(100,116,139,0.45)',
      background: '#e7ebf2',
    })
  })

  it('pausedChipStyle: solid slate fill (the set-aside mirror of the due / stale chips)', () => {
    expect(pausedChipStyle()).toEqual({ backgroundColor: 'rgb(100,116,139)', color: '#fff' })
  })

  it('pausedChipLabel: "⏸ starts <day>", reusing formatStartDay', () => {
    expect(pausedChipLabel('2026-07-30')).toBe('⏸ starts Jul 30')
    // A full ISO timestamp is sliced to its wall-clock day, same as formatStartDay.
    expect(pausedChipLabel('2026-08-01T09:30:00Z')).toBe('⏸ starts Aug 1')
  })

  it('pausedChipLabel: falls back to a bare "⏸ paused" for a missing/unparseable date', () => {
    expect(pausedChipLabel(null)).toBe('⏸ paused')
    expect(pausedChipLabel(undefined)).toBe('⏸ paused')
    expect(pausedChipLabel('not-a-date')).toBe('⏸ paused')
  })

  it('pausedBadge: the 💤 corner flag (the paused member of the 🔥/❄️ family) + spelled-out title', () => {
    expect(pausedBadge('2026-07-30')).toEqual({ glyph: '💤', title: 'Paused — starts Jul 30' })
    expect(pausedBadge(null)).toEqual({ glyph: '💤', title: 'Paused' })
    expect(pausedBadge('not-a-date')).toEqual({ glyph: '💤', title: 'Paused' })
  })

  it('PAUSED_OPACITY dims the card but keeps it legible (not a fade-out)', () => {
    expect(PAUSED_OPACITY).toBeGreaterThan(0.5)
    expect(PAUSED_OPACITY).toBeLessThan(1)
  })
})
