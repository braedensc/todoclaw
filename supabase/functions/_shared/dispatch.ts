// dispatch.ts — the pure decision + content logic for the proactive dispatcher (ADR-0031), split out
// from the edge function so it is unit-testable without a DB or a clock. The function itself (I/O,
// guardrails, push) composes these. Two concerns:
//   • WHO is due, and for WHAT — matching a user's local hour against their morning/evening prefs,
//     with quiet-hours suppression (localHourInTZ / isQuietHour / dueKind).
//   • the message CONTENT — a plan-rich morning (EisenClaw-Telegram style: headline, big rock, quick
//     wins, habits) with a deterministic fallback when no plan exists, and an evening check-in built
//     from that morning's plan ("which of these did you knock out?").

import { dayNameInTZ, localDateInTZ } from './dates.ts'
import { formatClockTime } from './reminder-content.ts'
import type { PlanResult, Rock } from './plan-prompt.ts'

// Notifications prefs, as the client writes them into user_schedule.config.notifications (PR8) and
// notification_candidates() returns them. All optional — a missing/false `enabled` means never due.
export interface NotificationPrefs {
  enabled?: boolean
  name?: string // optional first name for the greeting ("Good morning Alex! ☀️")
  morningHour?: number // 0–23, local; when the plan push goes out
  eveningHour?: number // 0–23, local; when the recap push goes out
  quietStartHour?: number // inclusive; suppress pushes from here…
  quietEndHour?: number // …to here (exclusive). Wraps past midnight when start > end.
  quietWhenEmpty?: boolean // opt-in: skip a digest that would have nothing to say (see isEmptyDigest)
}

export type DueKind = 'plan' | 'recap'

// daily_state.plan as this module consumes it — the emit_plan output shape (plan-prompt.ts), but
// all-optional because the column is client-validated jsonb and opaque to the DB. Derived from the
// canonical Rock/PlanResult types so a schema change there surfaces here as a type error.
export type DispatchPlanRock = Partial<Pick<Rock, 'task' | 'duration'>>
export type DispatchPlan = Partial<Pick<PlanResult, 'headline'>> & {
  bigRock?: DispatchPlanRock | null
  smallRocks?: DispatchPlanRock[]
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/**
 * Normalize an untrusted plan value (opaque jsonb: a user can write ANY shape to their own
 * daily_state.plan row) into a well-typed DispatchPlan, or null when there's no usable plan.
 * Mis-typed fields degrade to absent — the builders below must never throw inside the dispatch loop.
 */
export function normalizePlan(raw: unknown): DispatchPlan | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const p = raw as Record<string, unknown>
  const rock = (v: unknown): DispatchPlanRock | null => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
    const r = v as Record<string, unknown>
    return { task: asString(r.task), duration: asString(r.duration) }
  }
  return {
    headline: asString(p.headline),
    bigRock: rock(p.bigRock),
    smallRocks: Array.isArray(p.smallRocks)
      ? p.smallRocks.map(rock).filter((r): r is DispatchPlanRock => r !== null)
      : [],
  }
}

// The inputs bundle dispatch_inputs_for_user returns (jsonb → this shape).
export interface DispatchInputs {
  config: { location?: string; notifications?: NotificationPrefs } | null
  tasks: {
    id: string
    text: string
    x: number | null
    y: number | null
    due: string | null
    due_time: string | null
    // Coarse effort (S/M/L/XL) or null — provided by dispatch_inputs_for_user so the proactive
    // morning plan honors the same size guardrail as interactive Plan My Day.
    size: string | null
    // Permanent one-off completion marker (tasks.completed_at). dispatch_inputs_for_user already
    // filters completed tasks out at the SQL WHERE clause, so this key is normally ABSENT here; the
    // builders below still self-guard on it (belt-and-suspenders for the deploy-skew window where new
    // function code runs against a not-yet-migrated RPC) — hence optional.
    completed_at?: string | null
    staged: boolean
    recurring: { frequencyDays: number; lastDoneAt: string | null; doneCount: number } | null
  }[]
  habits: { id: string; text: string; active: boolean }[]
  done: Record<string, boolean>
  habit_done: Record<string, boolean>
  plan: DispatchPlan | null
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

// How many hours past a configured send-hour we'll still deliver, when earlier ticks were dropped.
// The trigger can skip ticks (the GitHub Actions backup routinely does; even the per-minute pg_cron
// can miss a stretch across a DB restart), and the exact-hour match this used to require meant a
// single skipped tick at the user's morning hour silently lost the whole day's push. The daily claim (claim_message) makes every
// tick idempotent, so widening the match to a short window is safe: the FIRST surviving tick at or
// after the hour delivers, and a dropped tick is simply recovered by the next one. Bounded so a plan
// never lands at night ("Good morning" at 9pm) — a digest hours late is noise, and the in-app inbox
// already covers a fully missed day.
const CATCHUP_HOURS = 4

// Hours from `configuredHour` forward to `localHour`, wrapping past midnight (0 when equal, 23 one
// hour before). Membership test for the [configuredHour, configuredHour + CATCHUP_HOURS) window.
function inCatchupWindow(configuredHour: number | undefined, localHour: number): boolean {
  if (configuredHour == null) return false
  return (localHour - configuredHour + 24) % 24 < CATCHUP_HOURS
}

// What (if anything) is this user due for at `localHour`? Disabled or quiet → nothing. Otherwise the
// hour must fall in the catch-up window at or after a configured morning/evening hour (CATCHUP_HOURS):
// the first non-quiet tick in that window delivers, the daily claim keeps the rest idempotent. Morning
// wins if both windows cover the hour (only reachable with tightly spaced prefs).
export function dueKind(prefs: NotificationPrefs, localHour: number): DueKind | null {
  if (prefs.enabled !== true) return null
  if (isQuietHour(prefs, localHour)) return null
  if (inCatchupWindow(prefs.morningHour, localHour)) return 'plan'
  if (inCatchupWindow(prefs.eveningHour, localHour)) return 'recap'
  return null
}

export interface MessageContent {
  title: string
  body: string
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// The optional greeting name (config.notifications.name), normalized: trimmed, or null.
function greetName(inputs: DispatchInputs): string | null {
  const name = asString(inputs.config?.notifications?.name)?.trim()
  return name ? name : null
}

function morningTitle(inputs: DispatchInputs): string {
  const name = greetName(inputs)
  return `Good morning${name ? ` ${name}` : ''}! ☀️`
}

// "Open" = placed on the grid, not staged, not completed, not done today — mirrors buildPlanRequest's
// selection. completed_at is the permanent one-off marker (see DispatchInputs.tasks): normally already
// filtered by the RPC, guarded here too so a completed task never surfaces.
function openPlacedTasks(inputs: DispatchInputs): DispatchInputs['tasks'] {
  return inputs.tasks.filter(
    (t) => !t.staged && !t.completed_at && !inputs.done[t.id] && t.x != null && t.y != null,
  )
}

const SIGNOFF = '— BabyClaw 🐾'

// Push bodies must stay small (the encrypted payload caps near 4KB and the OS truncates display
// anyway) and the plan is opaque jsonb, so never render an unbounded list: cap the sections.
const QUICK_WINS_CAP = 10
const CHECKIN_ITEMS_CAP = 10
const TIMES_CAP = 8

// One "• task (~duration)" line. Guards a malformed rock (opaque jsonb): no task text → no line.
function rockLine(rock: DispatchPlanRock): string | null {
  const task = rock.task?.trim()
  if (!task) return null
  const duration = rock.duration?.trim()
  return duration ? `• ${task} (${duration})` : `• ${task}`
}

// "⏰ TODAY" lines — tasks with a due TIME landing on the user's local `today`, earliest first, not
// done. The time is wall-clock (formatClockTime, no tz math). Capped like every other section.
function timedTodayLines(inputs: DispatchInputs, localDate: string, cap = TIMES_CAP): string[] {
  return inputs.tasks
    .filter(
      (t) =>
        !t.completed_at &&
        !inputs.done[t.id] &&
        t.due != null &&
        t.due.slice(0, 10) === localDate &&
        !!t.due_time,
    )
    .sort((a, b) => (a.due_time! < b.due_time! ? -1 : a.due_time! > b.due_time! ? 1 : 0))
    .slice(0, cap)
    .map((t) => `• ${formatClockTime(t.due_time!)} — ${t.text}`)
}

// Active habits not yet done today — the 💪 section. Capped so the push body stays scannable.
function habitLines(inputs: DispatchInputs, cap = 8): string[] {
  return inputs.habits
    .filter((h) => h.active && !inputs.habit_done[h.id])
    .slice(0, cap)
    .map((h) => `• ${h.text}`)
}

// Does today's plan carry at least one real rock (big or quick) with task text? A finished plan
// still has rocks — so this stays true even when everything's done (worth a celebratory recap).
function planHasRocks(inputs: DispatchInputs): boolean {
  const plan = normalizePlan(inputs.plan)
  return (
    !!plan &&
    (!!plan.bigRock?.task?.trim() || (plan.smallRocks ?? []).some((r) => !!r.task?.trim()))
  )
}

// Would today's morning push be an empty "clear slate" — nothing to plan, time, or nudge? Checked
// BEFORE plan generation so an empty day also skips the AI call. A plan can only surface rocks from
// existing tasks, so "no open task, no timed task today, no undone habit" ⇒ nothing to say.
export function isEmptyMorning(inputs: DispatchInputs, localDate: string): boolean {
  return (
    !planHasRocks(inputs) &&
    openPlacedTasks(inputs).length === 0 &&
    timedTodayLines(inputs, localDate).length === 0 &&
    habitLines(inputs).length === 0
  )
}

// Would tonight's check-in be empty — no plan to ask about AND nothing on the board to nudge?
export function isEmptyEvening(inputs: DispatchInputs): boolean {
  return !planHasRocks(inputs) && openPlacedTasks(inputs).length === 0
}

// The dispatcher's opt-in "quiet when empty" gate (config.notifications.quietWhenEmpty): true ⇒ skip
// this due digest entirely — no claim, no AI generation, no push.
export function isEmptyDigest(kind: DueKind, inputs: DispatchInputs, localDate: string): boolean {
  return kind === 'plan' ? isEmptyMorning(inputs, localDate) : isEmptyEvening(inputs)
}

/**
 * The morning push, from the day's actual plan — the EisenClaw-Telegram shape: greeting + headline,
 * then only the sections the plan actually filled (🪨 big rock / ⚡ quick wins / 💪 habits). A light
 * plan renders light: the prompt already treats "an open day is valid" as a first-class outcome, so
 * this formatter never pads — no rocks means headline + habits (or an explicit open-day line), not a
 * manufactured to-do list.
 */
export function buildMorningFromPlan(
  rawPlan: DispatchPlan,
  inputs: DispatchInputs,
  localDate: string,
): MessageContent {
  const title = morningTitle(inputs)
  // Re-normalize even a typed argument — the value ultimately came from opaque jsonb and the cast
  // at the RPC boundary is a promise the DB doesn't keep.
  const plan = normalizePlan(rawPlan) ?? {}

  const sections: string[] = []
  const times = timedTodayLines(inputs, localDate)
  const big = plan.bigRock ? rockLine(plan.bigRock) : null
  const quick = (plan.smallRocks ?? [])
    .map(rockLine)
    .filter((line): line is string => line !== null)
    .slice(0, QUICK_WINS_CAP)

  // The AI headline leads — EXCEPT when the plan is rock-less yet a timed anchor exists today: a
  // headline like "nothing pressing" would then contradict the ⏰ TODAY list right below it, so
  // drop it and let the anchor speak.
  const headline = plan.headline?.trim()
  const headlineContradicts = !big && quick.length === 0 && times.length > 0
  if (headline && !headlineContradicts) sections.push(headline)

  // Fixed anchors first — anything due at a specific time today, so the times are unmissable.
  if (times.length > 0) sections.push(`⏰ TODAY\n${times.join('\n')}`)

  if (big) sections.push(`🪨 BIG ROCK\n${big}`)
  if (quick.length > 0) sections.push(`⚡ QUICK WINS\n${quick.join('\n')}`)

  const habits = habitLines(inputs)
  if (habits.length > 0) sections.push(`💪 HABITS\n${habits.join('\n')}`)

  // A plan with no rocks IS the message ("open day") — but not if there's a timed anchor today.
  if (!big && quick.length === 0 && times.length === 0)
    sections.push('Nothing pressing on the board — enjoy the open day 🙂')

  sections.push(SIGNOFF)
  return { title, body: sections.join('\n\n') }
}

// The deterministic morning fallback — ships when no plan exists and AI is paused/failed, so the
// send never depends on the model. A load summary, not a fake plan.
export function buildMorningMessage(inputs: DispatchInputs, localDate: string): MessageContent {
  const open = openPlacedTasks(inputs)
  const habits = inputs.habits.filter((h) => h.active)
  const bits: string[] = []
  if (open.length > 0) bits.push(plural(open.length, 'task', 'tasks'))
  if (habits.length > 0) bits.push(plural(habits.length, 'habit', 'habits'))
  const load = bits.length > 0 ? `${bits.join(' and ')} on deck` : 'a clear slate'
  const times = timedTodayLines(inputs, localDate)
  const timesBlock = times.length > 0 ? `\n\n⏰ TODAY\n${times.join('\n')}` : ''
  return {
    title: morningTitle(inputs),
    body: `${load} today. Tap to plan your day.${timesBlock}`,
  }
}

/** What buildRecapMessage needs beyond the inputs bundle — the user's local "today". */
export interface RecapContext {
  dayName: string // "Wednesday", in the user's zone
  timeZone: string
  localDate: string // YYYY-MM-DD, the user's local calendar day
}

// Was this recurring chore completed today? Recurring tasks never touch daily_state.done — the app
// records completion by resetting recurring.lastDoneAt (they reset, not archive) — so the check-in
// must read that signal or a chore done this morning would be re-asked every single evening.
function recurringDoneToday(task: DispatchInputs['tasks'][number], ctx: RecapContext): boolean {
  const iso = task.recurring?.lastDoneAt
  if (!iso) return false
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return false
  return localDateInTZ(ctx.timeZone, at) === ctx.localDate
}

/**
 * The evening push — a check-in, not a stats dump. Built from that morning's plan: list its still-
 * unfinished items numbered and ask which got knocked out (the reply lands in chat, where BabyClaw
 * marks them done). Done-ness is matched by task text against today's done map (plus lastDoneAt for
 * recurring chores); an item we can't match stays on the list (better to ask than to silently drop).
 * No plan on file → a gentle generic check-in; everything finished → celebrate and stop. Rest days
 * are always a fine answer.
 */
export function buildRecapMessage(inputs: DispatchInputs, ctx: RecapContext): MessageContent {
  const name = greetName(inputs)
  const greet = name ? `Hey ${name}! ` : ''

  const plan = normalizePlan(inputs.plan)
  const rocks: DispatchPlanRock[] = plan
    ? [...(plan.bigRock ? [plan.bigRock] : []), ...(plan.smallRocks ?? [])]
    : []
  const items = rocks.map((r) => r.task?.trim()).filter((t): t is string => Boolean(t))

  if (items.length === 0) {
    // No plan today (or an empty one): check in generally instead of pretending there was a list.
    const open = openPlacedTasks(inputs)
    const board =
      open.length > 0
        ? ` There ${open.length === 1 ? 'is' : 'are'} ${plural(open.length, 'task', 'tasks')} on the board whenever you're ready.`
        : ''
    return {
      title: 'Evening check-in 👋',
      body:
        `${greet}No morning plan on file today, so just checking in — how did the day go? ` +
        `Anything get crossed off?${board}\n\n` +
        `Reply with anything you finished and I'll mark it done. No pressure either way 🙂\n\n${SIGNOFF}`,
    }
  }

  // Which plan items still look open? Match by exact task text; unmatched items stay listed.
  const doneTexts = new Set(
    inputs.tasks.filter((t) => inputs.done[t.id] || recurringDoneToday(t, ctx)).map((t) => t.text),
  )
  const unfinished = items.filter((t) => !doneTexts.has(t))

  if (unfinished.length === 0) {
    return {
      title: `Wrapping up ${ctx.dayName} 🎉`,
      body: `${greet}You cleared the whole plan today — nicely done. Take the evening 🙂\n\n${SIGNOFF}`,
    }
  }

  const shown = unfinished.slice(0, CHECKIN_ITEMS_CAP)
  const list = shown.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const more =
    unfinished.length > shown.length ? `\n…and ${unfinished.length - shown.length} more` : ''
  return {
    title: `Wrapping up ${ctx.dayName} 👋`,
    body:
      `${greet}Which of these did you knock out today?\n\n${list}${more}\n\n` +
      `Reply with the numbers or names and I'll mark them done. No worries if today was a rest day 🙂\n\n${SIGNOFF}`,
  }
}
