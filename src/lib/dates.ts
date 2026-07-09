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
 * The instant a per-task reminder should fire: the wall-clock due (`due` + `dueTime` in
 * `timeZone`) minus `offsetMinutes` (0 = at the due time). The client materializes this into
 * `task_reminders.fire_at` on write; the DB triggers recompute it identically when the due or the
 * timezone changes (ADR 2026-07-09). Throws (via dueInstant) on unparseable inputs.
 */
export function reminderFireAt(
  due: string,
  dueTime: string,
  offsetMinutes: number,
  timeZone: string,
): Date {
  return new Date(
    dueInstant(due.slice(0, 10), dueTime, timeZone).getTime() - offsetMinutes * 60_000,
  )
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

/**
 * Localized display of a wall-clock due time — 'HH:MM' (time input) or the Postgres `time` wire
 * format 'HH:MM:SS' — as e.g. "3:00 PM". Pure clock formatting, deliberately NO timezone math:
 * the stored value already IS the user's wall clock (ADR 2026-07-08-due-dates-wall-clock).
 * Returns '' for an unparseable input.
 */
export function formatDueTime(hms: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(hms)
  if (!m) return ''
  const local = new Date(2000, 0, 1, Number(m[1]), Number(m[2]))
  return local.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Whole minutes until a timed task's due instant (negative = past), or null when the task has
 * no due time or the inputs don't parse. The tz-aware bridge between the wall-clock columns and
 * the live countdown / timed-overdue tiers (visual-urgency.ts) — callers pass a shared `now`
 * from useNow so a whole view ticks on one clock.
 */
export function minutesUntilDueTime(
  due: string | null,
  dueTime: string | null,
  timeZone: string,
  now: Date,
): number | null {
  if (!due || !dueTime) return null
  try {
    const instant = dueInstant(due.slice(0, 10), dueTime, timeZone)
    return Math.round((instant.getTime() - now.getTime()) / 60_000)
  } catch {
    return null
  }
}
