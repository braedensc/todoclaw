// Date helpers. The whole point of `localDateInTZ` is correctness: the daily reset and
// the `daily_state.date` partition key must be computed in the USER's timezone, not the
// server's (or the browser's) UTC offset. EisenClaw mixed UTC and local time here, a real
// bug (planning/EISENCLAW-LOGIC-TO-PORT.md, Discrepancies #3). This helper is the single
// canonical "what calendar day is it for this user" used everywhere that boundary matters.

/**
 * The calendar date (YYYY-MM-DD) in the given IANA timezone for `instant` (default: now).
 *
 * Uses Intl with `formatToParts` so the result is a deterministic ISO `YYYY-MM-DD`
 * regardless of host locale. Throws RangeError if `timeZone` is not a recognized IANA
 * zone — callers pass a validated `user_schedule.timezone`.
 */
export function localDateInTZ(timeZone: string, instant: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? ''

  return `${get('year')}-${get('month')}-${get('day')}`
}
