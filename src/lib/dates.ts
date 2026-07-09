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

/**
 * The wall-clock reading an observer in `timeZone` sees at `instant`, re-encoded as a UTC
 * epoch-ms value — i.e. "what the zone's clock says", made comparable with arithmetic.
 */
function wallClockAsUTC(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN)

  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
}

/**
 * Project a wall-clock due — floating `'YYYY-MM-DD'` date + `'HH:MM'`/`'HH:MM:SS'` time-of-day,
 * both meant in `timeZone` — to the real instant it names (ADR 2026-07-08-due-dates-wall-clock).
 * This is the ONLY place a due date/time becomes an instant; everything else treats them as
 * calendar values. Used for countdown chips and reminder fire times.
 *
 * Pure Intl (no tz library): start from the wall time encoded as UTC, then correct by the zone's
 * observed offset, twice, so DST transitions converge. During the spring-forward gap a
 * nonexistent time resolves deterministically to the same wall-clock reading shifted one hour
 * earlier; an ambiguous fall-back time resolves to its first (pre-transition) occurrence.
 *
 * Throws RangeError on an unparseable date/time (callers pass DB-validated values) — matching
 * `localDateInTZ`, which throws on an unknown zone.
 */
export function dueInstant(due: string, dueTime: string, timeZone: string): Date {
  const hms = /^\d{2}:\d{2}$/.test(dueTime) ? `${dueTime}:00` : dueTime
  const target = Date.parse(`${due}T${hms}Z`)
  if (Number.isNaN(target)) {
    throw new RangeError(`dueInstant: unparseable due '${due}' / dueTime '${dueTime}'`)
  }
  let guess = target
  for (let i = 0; i < 2; i++) {
    guess += target - wallClockAsUTC(timeZone, new Date(guess))
  }
  return new Date(guess)
}

/**
 * Human display of an ISO instant as `"May 19 at 12:18 AM"` (host-locale month/day + time).
 * Used by the Done tab and the Backups panel for completion/snapshot timestamps. Unlike
 * `localDateInTZ` (a correctness-critical partition key), this is presentation only — it follows
 * the browser locale. Returns `''` for an unparseable input.
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${day} at ${time}`
}
