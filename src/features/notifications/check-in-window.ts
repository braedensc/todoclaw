import type { InboxMessage } from './use-messages'

// WHICH of BabyClaw's check-ins are CURRENT — the single source of truth behind both the
// "From BabyClaw" list and the nav/Chat-tab unread badge, so the two can never disagree.
//
// The badge used to count every unread `messages` row while the list capped what it showed; the cap
// then had to EXEMPT unread rows to keep the badge landing on a visible one. That kept them in sync
// but inverted the point of the cap: a morning plan + an evening recap arrive every day whether or
// not you open the app, so a week away meant a "9+" badge over a list of nine stale check-ins —
// a number that only measured absence. Now there is ONE set. The cap is a hard cap, the badge counts
// the unread inside it, and both answer the same question: what's worth your attention right now.
//
// This is a DISPLAY window, not retention: nothing is deleted (`messages` has no DELETE grant and no
// prune job — a row outlives the window and dies only with the account), and "Mark all read" still
// clears every unread row, windowed or not.

/** How many check-ins the list shows (and therefore the most the badge can ever say). */
export const MAX_CHECK_INS = 5

/**
 * How long a check-in stays current. Almost always the cap bites first — at ~2 a day, five rows is
 * about two days of history. This is the other end: when the cadence has stopped (push turned off,
 * a paused AI budget), it keeps a three-week-old plan from sitting there as an unread "1" forever.
 * Measured against last activity, so a check-in you replied to yesterday is fresh however old it is.
 */
export const STALE_AFTER_DAYS = 7

/** Just enough of a chat session to date it — `useChatSessions`' rows satisfy this. */
export interface SessionClock {
  id: string
  updated_at: string
}

/** A current check-in and the timestamp it was ranked (and stamped) by. */
export interface CheckIn {
  msg: InboxMessage
  /** Its last message: the session's `updated_at` once opened, else its arrival. */
  time: string
}

/**
 * The current check-ins, newest activity first.
 *
 * Ranked by LAST MESSAGE, not arrival. `messages` is ordered by `created_at` — when BabyClaw SENT a
 * check-in — so replying to Monday's plan today would leave it three days down and the cap would
 * drop the very conversation you were mid-reply in. Once opened, a check-in has a session whose
 * `updated_at` is bumped by every turn; an unopened one has no session, so its arrival IS its last
 * message. Rank first, then window — the other order keeps the wrong ones.
 */
export function visibleCheckIns(
  messages: readonly InboxMessage[] | undefined,
  sessions: readonly SessionClock[] | undefined,
  now: number = Date.now(),
): CheckIn[] {
  const byId = new Map((sessions ?? []).map((s) => [s.id, s]))
  const lastActivity = (m: InboxMessage) =>
    (m.session_id ? byId.get(m.session_id)?.updated_at : null) ?? m.created_at
  const staleBefore = now - STALE_AFTER_DAYS * 86_400_000
  return (
    [...(messages ?? [])]
      .map((msg) => ({ msg, time: lastActivity(msg) }))
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
      // An unparseable timestamp sorts last but must not be read as "1970" and silently dropped.
      .filter((c) => {
        const t = Date.parse(c.time)
        return Number.isNaN(t) || t >= staleBefore
      })
      .slice(0, MAX_CHECK_INS)
  )
}

/** The badge: unread among the CURRENT check-ins — never more than the list is showing. */
export function unreadCheckInCount(visible: readonly CheckIn[]): number {
  return visible.reduce((n, c) => n + (c.msg.read_at ? 0 : 1), 0)
}
