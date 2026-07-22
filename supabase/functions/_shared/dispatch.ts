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
import { activityTally, type ActivityRow } from './activity.ts'

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

// Membership test for the [configuredHour, configuredHour + CATCHUP_HOURS) window, bounded to the
// LOCAL DAY — it does NOT wrap past midnight. This matters only for a late evening hour (the default
// recap is 21:00, window [21, 24)): a recap must never deliver at 00:xx, because by then the local
// date has rolled over, so `dispatch_inputs_for_user` would read the NEW (empty) day's plan AND
// `claim_message` would burn the new day's recap slot — a post-midnight "recap" is both wrong-day and
// self-perpetuating. Skipping a fully-missed digest beats sending a corrupt one. Morning hours are
// small, never approached midnight, and are unaffected.
function inCatchupWindow(configuredHour: number | undefined, localHour: number): boolean {
  if (configuredHour == null) return false
  return localHour >= configuredHour && localHour - configuredHour < CATCHUP_HOURS
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
export function greetName(inputs: DispatchInputs): string | null {
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

// Would tonight's check-in be empty — no plan to ask about, nothing on the board to nudge, AND
// nothing logged today? A day with any activity is worth a recap (there's something to celebrate),
// so it is never "empty" once actions exist.
export function isEmptyEvening(inputs: DispatchInputs, activity: ActivityRow[] = []): boolean {
  return activity.length === 0 && !planHasRocks(inputs) && openPlacedTasks(inputs).length === 0
}

// The dispatcher's opt-in "quiet when empty" gate (config.notifications.quietWhenEmpty): true ⇒ skip
// this due digest entirely — no claim, no AI generation, no push.
export function isEmptyDigest(
  kind: DueKind,
  inputs: DispatchInputs,
  localDate: string,
  activity: ActivityRow[] = [],
): boolean {
  return kind === 'plan' ? isEmptyMorning(inputs, localDate) : isEmptyEvening(inputs, activity)
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
 * The morning plan's items split into what got done today vs. what's still open — the shared source
 * of truth for both the deterministic recap body and the AI recap prompt (so they never disagree).
 * Done-ness is matched by exact task text against today's done map (plus lastDoneAt for recurring
 * chores); an unmatched item stays "open" (better to ask than to silently drop). hasPlan=false when
 * there was no plan today.
 */
export function recapPlanItems(
  inputs: DispatchInputs,
  ctx: RecapContext,
): { done: string[]; open: string[]; hasPlan: boolean } {
  const plan = normalizePlan(inputs.plan)
  const rocks: DispatchPlanRock[] = plan
    ? [...(plan.bigRock ? [plan.bigRock] : []), ...(plan.smallRocks ?? [])]
    : []
  const items = rocks.map((r) => r.task?.trim()).filter((t): t is string => Boolean(t))
  if (items.length === 0) return { done: [], open: [], hasPlan: false }
  const doneTexts = new Set(
    inputs.tasks.filter((t) => inputs.done[t.id] || recurringDoneToday(t, ctx)).map((t) => t.text),
  )
  return {
    done: items.filter((t) => doneTexts.has(t)),
    open: items.filter((t) => !doneTexts.has(t)),
    hasPlan: true,
  }
}

// Whole-day count between two 'YYYY-MM-DD' floating dates (both wall-clock — parse as UTC midnights
// so the diff is an exact day count regardless of the reader's zone).
function dayDelta(fromDate: string, toDate: string): number {
  return Math.round(
    (Date.parse(`${toDate.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${fromDate.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  )
}

const LOOKAHEAD_DAYS = 3
const UPCOMING_CAP = 5

/**
 * The look-ahead bundle — the "anything coming up" material. Tasks due in the next few days (timed
 * ones carry their clock time) plus recurring chores whose next cycle lands tomorrow / the day after,
 * excluding anything already done today. Human strings, soonest first — fed to the AI recap and
 * summarized in the deterministic fallback.
 */
export function upcomingItems(inputs: DispatchInputs, ctx: RecapContext): string[] {
  const rows: { inDays: number; timed: boolean; text: string }[] = []
  for (const t of inputs.tasks) {
    if (inputs.done[t.id]) continue
    if (t.due) {
      const inDays = dayDelta(ctx.localDate, t.due)
      if (inDays >= 1 && inDays <= LOOKAHEAD_DAYS) {
        const when = inDays === 1 ? 'tomorrow' : `in ${inDays} days`
        const time = t.due_time ? ` at ${formatClockTime(t.due_time)}` : ''
        rows.push({ inDays, timed: !!t.due_time, text: `${t.text}${time} — due ${when}` })
        continue
      }
    }
    const rec = t.recurring
    if (rec?.frequencyDays && rec.lastDoneAt && !recurringDoneToday(t, ctx)) {
      const at = Date.parse(rec.lastDoneAt)
      if (!Number.isNaN(at)) {
        const next = localDateInTZ(ctx.timeZone, new Date(at + rec.frequencyDays * 86_400_000))
        const inDays = dayDelta(ctx.localDate, next)
        if (inDays >= 1 && inDays <= 2) {
          rows.push({
            inDays,
            timed: false,
            text: `${t.text} — recurring, due ${inDays === 1 ? 'tomorrow' : `in ${inDays} days`}`,
          })
        }
      }
    }
  }
  rows.sort((a, b) => a.inDays - b.inDays || (a.timed === b.timed ? 0 : a.timed ? -1 : 1))
  return rows.slice(0, UPCOMING_CAP).map((r) => r.text)
}

/**
 * The evening push — a check-in, not a stats dump. This is the DETERMINISTIC fallback (used when AI
 * is paused or generation fails; the AI path — run-recap.ts — is primary). Built from that morning's
 * plan (recapPlanItems): acknowledge what got done, list still-open items and ask, and weave in a
 * one-line activity tally + a short look-ahead so even the fallback reflects the day and what's next.
 * No plan on file → a gentle generic check-in that still credits a productive day; everything
 * finished → celebrate. A rest day is always a fine answer.
 */
export function buildRecapMessage(
  inputs: DispatchInputs,
  ctx: RecapContext,
  activity: ActivityRow[] = [],
): MessageContent {
  const name = greetName(inputs)
  const greet = name ? `Hey ${name}! ` : ''
  const { done, open, hasPlan } = recapPlanItems(inputs, ctx)
  const tally = activityTally(activity)
  // Drop look-ahead items already named as plan items above — no double-listing "the dentist" as
  // both a still-open item and a heads-up (the AI path keeps them raw and dedupes in prose instead).
  const planTexts = [...done, ...open]
  const upcoming = upcomingItems(inputs, ctx).filter(
    (line) => !planTexts.some((p) => line.startsWith(p)),
  )
  const upcomingLine = upcoming.length
    ? `\n\n🔭 Coming up: ${upcoming.slice(0, 2).join('; ')}.`
    : ''

  // No plan today: check in generally — but credit a productive day if there was any activity.
  if (!hasPlan) {
    const board = openPlacedTasks(inputs)
    const boardLine =
      board.length > 0
        ? ` There ${board.length === 1 ? 'is' : 'are'} ${plural(board.length, 'task', 'tasks')} on the board whenever you're ready.`
        : ''
    const opener = tally
      ? `Nice work today — ${tally}. How did the rest of the day go?`
      : `No morning plan on file today, so just checking in — how did the day go? Anything get crossed off?`
    return {
      title: 'Evening check-in 👋',
      body:
        `${greet}${opener}${boardLine}${upcomingLine}\n\n` +
        `Reply with anything you finished and I'll mark it done. No pressure either way 🙂\n\n${SIGNOFF}`,
    }
  }

  if (open.length === 0) {
    return {
      title: `Wrapping up ${ctx.dayName} 🎉`,
      body: `${greet}You cleared the whole plan today — nicely done. Take the evening 🙂${upcomingLine}\n\n${SIGNOFF}`,
    }
  }

  const shown = open.slice(0, CHECKIN_ITEMS_CAP)
  const list = shown.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const more = open.length > shown.length ? `\n…and ${open.length - shown.length} more` : ''
  const doneLine = done.length
    ? `Nice — already crossed off ${done.length === 1 ? `"${done[0]}"` : `${done.length} plan items`}.\n\n`
    : ''
  return {
    title: `Wrapping up ${ctx.dayName} 👋`,
    body:
      `${greet}${doneLine}Which of these did you knock out today?\n\n${list}${more}${upcomingLine}\n\n` +
      `Reply with the numbers or names and I'll mark them done. No worries if today was a rest day 🙂\n\n${SIGNOFF}`,
  }
}
