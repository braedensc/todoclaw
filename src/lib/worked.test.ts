import { describe, expect, it } from 'vitest'
import { WORKED_DAYS_CAP, workRecency, workedDetail, workedShort } from './worked'

// The session log is read by three consumers that must never disagree about the same array: the
// card counter (here), the plan request builder, and BabyClaw's task line (both via the Deno twin,
// supabase/functions/_shared/worked.ts). These tests are the oracle for all three — the twin's own
// test mirrors the same cases.

const TZ = 'America/New_York'
// 2026-07-17 01:30 UTC = 2026-07-16 21:30 in New York. The same instant is a DIFFERENT calendar day
// in the two zones, which is exactly the slip that would make "worked today" read as "yesterday"
// for anyone west of UTC. Same fixture instant as start-date.test.ts, for the same reason.
const NOW = new Date('2026-07-17T01:30:00Z')

const ongoing = (worked_days: string[] | null) => ({ ongoing: true, worked_days })

describe('workRecency', () => {
  it('is null for a task that is not an ongoing project', () => {
    // A chore and a one-off have no session log, so every caller renders nothing for them without
    // needing its own type check.
    expect(workRecency({ ongoing: false, worked_days: null }, TZ, NOW)).toBeNull()
    expect(workRecency({}, TZ, NOW)).toBeNull()
    // Even if a row somehow carries days (e.g. an ongoing project switched to a chore — the array
    // is deliberately left in place by the migration so switching back restores the history).
    expect(workRecency({ ongoing: false, worked_days: ['2026-07-16'] }, TZ, NOW)).toBeNull()
  })

  it('reports a never-worked project as having no sessions, not as zero days ago', () => {
    // daysSince must be null rather than 0 — "never worked" and "worked today" are opposites, and
    // a 0 here would make a brand-new project look like it was just handled.
    for (const days of [null, []]) {
      expect(workRecency(ongoing(days), TZ, NOW)).toEqual({
        lastWorked: null,
        daysSince: null,
        streak: 0,
        workedToday: false,
        sessions: 0,
      })
    }
  })

  it("resolves 'today' in the USER's zone, not UTC", () => {
    // 2026-07-16 is today in New York but YESTERDAY in UTC, from the same instant.
    expect(workRecency(ongoing(['2026-07-16']), TZ, NOW)).toMatchObject({
      daysSince: 0,
      workedToday: true,
    })
    expect(workRecency(ongoing(['2026-07-16']), 'UTC', NOW)).toMatchObject({
      daysSince: 1,
      workedToday: false,
    })
    // And Kiribati (UTC+14) is already on the 17th, so the 16th is yesterday there too.
    expect(workRecency(ongoing(['2026-07-16']), 'Pacific/Kiritimati', NOW)).toMatchObject({
      daysSince: 1,
      workedToday: false,
    })
  })

  it('counts days since the last session', () => {
    expect(workRecency(ongoing(['2026-07-15']), TZ, NOW)?.daysSince).toBe(1) // yesterday
    expect(workRecency(ongoing(['2026-07-11']), TZ, NOW)?.daysSince).toBe(5)
    expect(workRecency(ongoing(['2026-06-16']), TZ, NOW)?.daysSince).toBe(30)
  })

  it('counts a run of consecutive days ending at the last session', () => {
    expect(workRecency(ongoing(['2026-07-16', '2026-07-15', '2026-07-14']), TZ, NOW)).toMatchObject(
      {
        streak: 3,
        daysSince: 0,
        sessions: 3,
      },
    )
  })

  it('stops the run at the first gap', () => {
    // Worked today and yesterday, then a gap, then two more. The run is 2 — the older pair is
    // history, not part of the current push.
    expect(
      workRecency(ongoing(['2026-07-16', '2026-07-15', '2026-07-12', '2026-07-11']), TZ, NOW),
    ).toMatchObject({ streak: 2, sessions: 4 })
  })

  it('measures the run from the LAST session, not from today', () => {
    // Three days running that ended a week ago still reads as a run of three. That is what lets the
    // planner know the user already made a push at this project rather than treating it as untouched.
    expect(workRecency(ongoing(['2026-07-09', '2026-07-08', '2026-07-07']), TZ, NOW)).toMatchObject(
      {
        streak: 3,
        daysSince: 7,
        workedToday: false,
      },
    )
  })

  it('is a single day for a project chipped at once', () => {
    expect(workRecency(ongoing(['2026-07-16']), TZ, NOW)?.streak).toBe(1)
  })

  it('normalizes a stored array it does not trust', () => {
    // The RPC always writes de-duplicated, newest-first days. A restored backup or a hand-edited row
    // might not, and a wrong reading is worse than a defensive one.
    const messy = workRecency(
      ongoing(['2026-07-14', '2026-07-16', '2026-07-15', '2026-07-16']),
      TZ,
      NOW,
    )
    expect(messy).toMatchObject({ lastWorked: '2026-07-16', streak: 3, sessions: 3 })
  })

  it('drops malformed entries rather than propagating NaN', () => {
    const parsed = workRecency(
      ongoing(['not-a-date', '2026-07-16', '', '2026-13-99'] as string[]),
      TZ,
      NOW,
    )
    expect(parsed).toMatchObject({ lastWorked: '2026-07-16', sessions: 1, daysSince: 0 })
  })

  it('accepts a longer ISO string by slicing the calendar day', () => {
    expect(workRecency(ongoing(['2026-07-16T18:00:00Z']), TZ, NOW)).toMatchObject({
      lastWorked: '2026-07-16',
      workedToday: true,
    })
  })

  it('clamps a future-dated session to today rather than going negative', () => {
    // The RPC admits a ±2-day window around server UTC for device-clock skew, so a day slightly
    // ahead of the user's today can legitimately land here. It must read as "today", never as a
    // negative age that would sort ahead of everything else.
    expect(workRecency(ongoing(['2026-07-18']), TZ, NOW)).toMatchObject({
      daysSince: 0,
      workedToday: true,
    })
  })
})

describe('workedShort', () => {
  it('renders nothing when there is nothing to say', () => {
    expect(workedShort(null)).toBe('')
    expect(workedShort(workRecency(ongoing([]), TZ, NOW))).toBe('')
  })

  it('marks today, and otherwise counts days', () => {
    expect(workedShort(workRecency(ongoing(['2026-07-16']), TZ, NOW))).toBe('✓ today')
    expect(workedShort(workRecency(ongoing(['2026-07-15']), TZ, NOW))).toBe('1d')
    expect(workedShort(workRecency(ongoing(['2026-07-02']), TZ, NOW))).toBe('14d')
  })
})

describe('workedDetail', () => {
  it('renders nothing for a non-ongoing task and says so plainly when never worked', () => {
    expect(workedDetail(null)).toBe('')
    expect(workedDetail(workRecency(ongoing([]), TZ, NOW))).toBe('No sessions logged yet')
  })

  it('names today and yesterday in words, and older gaps in days', () => {
    expect(workedDetail(workRecency(ongoing(['2026-07-16']), TZ, NOW))).toBe('Worked today')
    expect(workedDetail(workRecency(ongoing(['2026-07-15']), TZ, NOW))).toBe('Worked yesterday')
    expect(workedDetail(workRecency(ongoing(['2026-07-11']), TZ, NOW))).toBe(
      'Last worked 5 days ago',
    )
  })

  it('mentions a run only once there is one', () => {
    expect(workedDetail(workRecency(ongoing(['2026-07-16', '2026-07-15']), TZ, NOW))).toBe(
      'Worked today, 2 days running · 2 sessions logged',
    )
  })

  it('marks the total as a floor once the log is at its cap', () => {
    // The array is capped, so beyond WORKED_DAYS_CAP the count is a floor on the true lifetime
    // total, not the total itself — say "14+" rather than assert a number that is quietly wrong.
    const capped = Array.from({ length: WORKED_DAYS_CAP }, (_, i) => {
      const day = 16 - i
      return `2026-07-${String(day).padStart(2, '0')}`
    })
    expect(workedDetail(workRecency(ongoing(capped), TZ, NOW))).toContain(
      `${WORKED_DAYS_CAP}+ sessions logged`,
    )
  })

  it('never characterises a gap as neglect', () => {
    // Tone is load-bearing: dropping a project for weeks and coming back is normal, healthy use of
    // an ongoing project. The copy states the fact and stops.
    const stale = workedDetail(workRecency(ongoing(['2026-05-01']), TZ, NOW))
    expect(stale).toBe('Last worked 76 days ago')
    for (const scold of ['neglect', 'still', 'finally', 'haven', 'overdue', 'behind', '!']) {
      expect(stale.toLowerCase()).not.toContain(scold)
    }
  })
})
