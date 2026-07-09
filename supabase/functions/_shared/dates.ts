// localDateInTZ — ported verbatim from src/lib/dates.ts (pure Intl; runs identically under
// Deno). The chat's complete_task tool needs the user's LOCAL calendar day to call
// set_task_done (mirroring daily_state.date). Kept in sync with the frontend copy; the deno
// test asserts the same fixtures as src/lib/dates.test.ts.

/** The user's weekday name ("Wednesday") in their own timezone — plan prompt, chat, dispatch. */
export function dayNameInTZ(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(now)
}

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

/** A bare `YYYY-MM-DD` calendar date with no time component. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const MS_PER_DAY = 86_400_000

/**
 * Whole-number calendar-day diff between `due` and `now` in the user's timezone — the single
 * server-side mirror of src/lib/scoring.ts `daysUntil` (used by placement, chat context, and
 * plan inputs; previously three drifting copies).
 *
 * Includes the PR #178 floating-date rule: a bare `'YYYY-MM-DD'` (the wire format of the
 * `tasks.due` DATE column, ADR-0032) is the user's own calendar date and is used verbatim — it
 * must NOT be routed through `new Date()`, which parses it as UTC midnight and lands on the
 * previous local day west of UTC, making a task read overdue on its own due date. A `due` that
 * carries a time component is a real instant and is projected into `timeZone` like `now`.
 */
export function daysUntilInTZ(due: string | null, timeZone: string, now: Date): number | null {
  if (!due) return null
  const dueYmd = DATE_ONLY.test(due) ? due : localDateInTZ(timeZone, new Date(due))
  const dueDay = Date.parse(`${dueYmd}T00:00:00Z`) / MS_PER_DAY
  const nowDay = Date.parse(`${localDateInTZ(timeZone, now)}T00:00:00Z`) / MS_PER_DAY
  return Math.round(dueDay - nowDay)
}
