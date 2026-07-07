// dispatch.ts — the pure decision + content logic for the proactive dispatcher (ADR-0031), split out
// from the edge function so it is unit-testable without a DB or a clock. The function itself (I/O,
// guardrails, push) composes these. Two concerns:
//   • WHO is due, and for WHAT — matching a user's local hour against their morning/evening prefs,
//     with quiet-hours suppression (localHourInTZ / isQuietHour / dueKind).
//   • the deterministic message CONTENT — a morning "here's your day" and the evening recap.

import { buildRecap } from './run-recap.ts'

// Notifications prefs, as the client writes them into user_schedule.config.notifications (PR8) and
// notification_candidates() returns them. All optional — a missing/false `enabled` means never due.
export interface NotificationPrefs {
  enabled?: boolean
  morningHour?: number // 0–23, local; when the plan push goes out
  eveningHour?: number // 0–23, local; when the recap push goes out
  quietStartHour?: number // inclusive; suppress pushes from here…
  quietEndHour?: number // …to here (exclusive). Wraps past midnight when start > end.
}

export type DueKind = 'plan' | 'recap'

// The inputs bundle dispatch_inputs_for_user returns (jsonb → this shape).
export interface DispatchInputs {
  config: { location?: string } | null
  tasks: {
    id: string
    text: string
    x: number | null
    y: number | null
    due: string | null
    staged: boolean
    recurring: { frequencyDays: number; lastDoneAt: string | null; doneCount: number } | null
  }[]
  habits: { id: string; text: string; active: boolean }[]
  done: Record<string, boolean>
  habit_done: Record<string, boolean>
}

// The user's current local hour (0–23). Pure given `now`; Intl does the DST/offset math.
export function localHourInTZ(timeZone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  return hour % 24 // some locales render midnight as '24'
}

// Is `hour` inside the user's quiet window? Handles a window that wraps past midnight (start > end).
export function isQuietHour(prefs: NotificationPrefs, hour: number): boolean {
  const { quietStartHour: s, quietEndHour: e } = prefs
  if (s == null || e == null || s === e) return false
  return s < e ? hour >= s && hour < e : hour >= s || hour < e
}

// What (if anything) is this user due for at `localHour`? Disabled or quiet → nothing. Otherwise the
// hour must exactly match a configured morning/evening hour (the hourly cron lands once per hour).
export function dueKind(prefs: NotificationPrefs, localHour: number): DueKind | null {
  if (prefs.enabled !== true) return null
  if (isQuietHour(prefs, localHour)) return null
  if (prefs.morningHour != null && localHour === prefs.morningHour) return 'plan'
  if (prefs.eveningHour != null && localHour === prefs.eveningHour) return 'recap'
  return null
}

export interface MessageContent {
  title: string
  body: string
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// The morning push. Deterministic: the real AI plan is generated separately and saved to daily_state
// (the app shows it on open); this notification just says "your day's ready" with a load summary, so
// it ships identically whether or not AI ran. Task selection mirrors buildPlanRequest (placed, not
// staged, not done today).
export function buildMorningMessage(inputs: DispatchInputs): MessageContent {
  const open = inputs.tasks.filter(
    (t) => !t.staged && !inputs.done[t.id] && t.x != null && t.y != null,
  )
  const habits = inputs.habits.filter((h) => h.active)
  const bits: string[] = []
  if (open.length > 0) bits.push(plural(open.length, 'task', 'tasks'))
  if (habits.length > 0) bits.push(plural(habits.length, 'habit', 'habits'))
  const load = bits.length > 0 ? `${bits.join(' and ')} on deck` : 'a clear slate'
  return { title: 'Good morning ☀️', body: `${load} today. Tap to plan your day.` }
}

// The evening push — the deterministic recap (run-recap.ts), adapted from the inputs bundle.
export function buildRecapMessage(inputs: DispatchInputs): MessageContent {
  const recap = buildRecap({
    tasks: inputs.tasks.map((t) => ({ id: t.id, text: t.text })),
    habits: inputs.habits.filter((h) => h.active).map((h) => ({ id: h.id, text: h.text })),
    doneTaskIds: inputs.done,
    doneHabitIds: inputs.habit_done,
  })
  return { title: recap.title, body: recap.body }
}
