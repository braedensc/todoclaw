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
