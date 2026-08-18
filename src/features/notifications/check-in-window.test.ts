import { describe, it, expect } from 'vitest'
import {
  visibleCheckIns,
  unreadCheckInCount,
  MAX_CHECK_INS,
  STALE_AFTER_DAYS,
  type SessionClock,
} from './check-in-window'
import type { InboxMessage } from './use-messages'

// THE CONTRACT THIS PINS: the badge can never claim more than the list is showing. Both sides come
// from `visibleCheckIns`, so every case below asserts the window and the count together — a change
// that lets one drift from the other has to break a test here.

const NOW = Date.parse('2026-08-18T09:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const daysAgo = (d: number) => hoursAgo(d * 24)

const m = (id: string, over: Partial<InboxMessage> = {}): InboxMessage => ({
  id,
  kind: 'plan',
  local_date: '2026-08-18',
  title: `Check-in ${id}`,
  body: '1. Ship the deck',
  read_at: null,
  created_at: hoursAgo(1),
  session_id: null,
  ...over,
})
const sess = (id: string, updated_at: string): SessionClock => ({ id, updated_at })
const ids = (rows: { msg: InboxMessage }[]) => rows.map((r) => r.msg.id)
const shown = (messages: InboxMessage[], sessions: SessionClock[] = []) =>
  visibleCheckIns(messages, sessions, NOW)

describe('visibleCheckIns', () => {
  it('shows nothing when there is nothing (and does not throw on undefined)', () => {
    expect(visibleCheckIns(undefined, undefined, NOW)).toEqual([])
    expect(unreadCheckInCount(visibleCheckIns(undefined, undefined, NOW))).toBe(0)
  })

  it('caps the list at MAX_CHECK_INS, newest first', () => {
    const msgs = Array.from({ length: 9 }, (_, i) => m(`m${i}`, { created_at: hoursAgo(i + 1) }))
    const rows = shown(msgs)
    expect(rows).toHaveLength(MAX_CHECK_INS)
    expect(ids(rows)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
  })

  it('hides UNREAD check-ins past the cap too — the whole point of the change', () => {
    // A morning plan and an evening recap arrive every day whether or not you open the app. Under
    // the old rule the cap exempted unread rows so the (uncapped) badge always landed on one, which
    // meant a week away = nine unread rows and a "9+" badge. Now the cap is a cap.
    const msgs = Array.from({ length: 9 }, (_, i) => m(`m${i}`, { created_at: hoursAgo(i + 1) }))
    const rows = shown(msgs)
    expect(ids(rows)).not.toContain('m5')
    expect(unreadCheckInCount(rows)).toBe(MAX_CHECK_INS)
  })

  it('counts only the unread rows it is showing — reading the current ones clears the badge', () => {
    // Five fresh check-ins on screen, four already read, plus four older unread ones behind the cap.
    const read = hoursAgo(0)
    const fresh = Array.from({ length: 5 }, (_, i) =>
      m(`f${i}`, { created_at: hoursAgo(i + 1), read_at: i === 0 ? null : read }),
    )
    const buried = Array.from({ length: 4 }, (_, i) => m(`b${i}`, { created_at: hoursAgo(i + 20) }))
    const rows = shown([...fresh, ...buried])
    expect(unreadCheckInCount(rows)).toBe(1)
    // …and reading that last one takes the badge to zero, however many are buried behind it.
    const allRead = shown([...fresh.map((x) => ({ ...x, read_at: read })), ...buried])
    expect(unreadCheckInCount(allRead)).toBe(0)
  })

  it('ranks a check-in by its LAST message, not when BabyClaw sent it', () => {
    // "old" arrived three days ago but you replied a minute ago; the live conversation belongs on
    // top, and must survive a cap that arrival order would push it out of.
    const msgs = [
      m('new', { created_at: hoursAgo(2) }),
      m('old', { created_at: hoursAgo(72), session_id: 's-old', read_at: hoursAgo(71) }),
    ]
    expect(ids(shown(msgs, [sess('s-old', hoursAgo(0))]))).toEqual(['old', 'new'])
  })

  it('stamps each row with the clock it was ranked by', () => {
    const rows = shown(
      [m('x', { created_at: hoursAgo(72), session_id: 's-x' })],
      [sess('s-x', hoursAgo(1))],
    )
    expect(rows[0]?.time).toBe(hoursAgo(1))
  })

  it('an unopened check-in ranks on its arrival — that IS its last message', () => {
    expect(
      ids(shown([m('a', { created_at: hoursAgo(5) }), m('b', { created_at: hoursAgo(1) })])),
    ).toEqual(['b', 'a'])
  })

  it('drops a check-in that has gone stale, so it stops counting toward the badge', () => {
    // The cap almost always bites first; this is the other end — the cadence stopped weeks ago and
    // one unread plan would otherwise sit there as a permanent "1".
    const rows = shown([m('ancient', { created_at: daysAgo(STALE_AFTER_DAYS + 1) })])
    expect(rows).toEqual([])
    expect(unreadCheckInCount(rows)).toBe(0)
  })

  it('keeps an old check-in you are still talking in — freshness is last activity', () => {
    const msgs = [m('old', { created_at: daysAgo(30), session_id: 's-old', read_at: daysAgo(30) })]
    expect(ids(shown(msgs, [sess('s-old', hoursAgo(2))]))).toEqual(['old'])
  })

  it('keeps a check-in right up to the cutoff', () => {
    const rows = shown([m('edge', { created_at: daysAgo(STALE_AFTER_DAYS - 0.5) })])
    expect(ids(rows)).toEqual(['edge'])
  })

  it('never drops a row for an unparseable timestamp — that would read as 1970 and vanish', () => {
    expect(ids(shown([m('weird', { created_at: 'not-a-date' })]))).toEqual(['weird'])
  })

  it('leaves the caller its own array — no mutation of the query cache', () => {
    const msgs = [m('a', { created_at: hoursAgo(9) }), m('b', { created_at: hoursAgo(1) })]
    shown(msgs)
    expect(msgs.map((x) => x.id)).toEqual(['a', 'b'])
  })
})
