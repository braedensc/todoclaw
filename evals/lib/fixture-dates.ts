// fixture-dates.ts — date helpers for eval fixtures, split by driver mode (see README "Dates").
//
// PLAN / RECAP scenarios run IN-PROCESS: the builders accept an explicit `now`, so those fixtures
// pin the clock to PLAN_NOW and derive every date from it — rot-free forever (the repo's
// fixture-date-rot lesson). CHAT scenarios drive the real edge function over HTTP where `now`
// cannot be injected, so their seeds MUST be now-relative: dates computed from the real clock at
// run time (scenario `seed` is a thunk, evaluated per run, so nothing is frozen at import time).

/** Pinned "now" for in-process plan/recap fixtures: a mid-September Tuesday, 9:00 AM New York. */
export const PLAN_NOW = new Date('2026-09-15T13:00:00.000Z')

export const DEFAULT_TZ = 'America/New_York'

/** 'YYYY-MM-DD' for `base` shifted by `days`, in `timeZone` — same digits the app's own
 * localDateInTZ would produce. Use with PLAN_NOW for pinned fixtures, or omit base for
 * now-relative chat seeds. */
export function dayOffsetISO(days: number, timeZone = DEFAULT_TZ, base?: Date): string {
  const b = base ?? new Date()
  const shifted = new Date(b.getTime() + days * 86_400_000)
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted)
}

/** ISO instant `days` before/after base (default: the real clock). For lastDoneAt-style fields. */
export function instantOffsetISO(days: number, base?: Date): string {
  const b = base ?? new Date()
  return new Date(b.getTime() + days * 86_400_000).toISOString()
}
