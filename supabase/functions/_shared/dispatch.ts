// dispatch.ts — the pure decision + content logic for the proactive dispatcher (ADR-0031), split out
// from the edge function so it is unit-testable without a DB or a clock. The function itself (I/O,
// guardrails, push) composes these. Two concerns:
//   • WHO is due, and for WHAT — matching a user's local hour against their morning/evening prefs,
//     with quiet-hours suppression (localHourInTZ / isQuietHour / dueKind).
//   • the message CONTENT — a plan-rich morning (EisenClaw-Telegram style: headline, big rock, quick
//     wins, habits) with a deterministic fallback when no plan exists, and an evening check-in built
//     from that morning's plan ("which of these did you knock out?").

// Notifications prefs, as the client writes them into user_schedule.config.notifications (PR8) and
// notification_candidates() returns them. All optional — a missing/false `enabled` means never due.
export interface NotificationPrefs {
  enabled?: boolean
  name?: string // optional first name for the greeting ("Good morning Braeden! ☀️")
  morningHour?: number // 0–23, local; when the plan push goes out
  eveningHour?: number // 0–23, local; when the recap push goes out
  quietStartHour?: number // inclusive; suppress pushes from here…
  quietEndHour?: number // …to here (exclusive). Wraps past midnight when start > end.
}

export type DueKind = 'plan' | 'recap'

// daily_state.plan as this module consumes it. The column is client-validated jsonb and opaque to the
// DB, so every field is optional here and the builders guard — an old or hand-edited plan row must
// degrade to a plainer message, never throw inside the dispatch loop.
export interface DispatchPlanRock {
  task?: string
  duration?: string // "~30min", "~1.5h" — already human-formatted by emit_plan
}
export interface DispatchPlan {
  headline?: string
  bigRock?: DispatchPlanRock | null
  smallRocks?: DispatchPlanRock[]
}

// The inputs bundle dispatch_inputs_for_user returns (jsonb → this shape).
export interface DispatchInputs {
  config: { location?: string; notifications?: { name?: string } } | null
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

/** The user's weekday name ("Wednesday") in their own timezone — for "Wrapping up Wednesday". */
export function dayNameInTZ(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(now)
}

// The optional greeting name (config.notifications.name), normalized: trimmed, or null.
function greetName(inputs: DispatchInputs): string | null {
  const name = inputs.config?.notifications?.name?.trim()
  return name ? name : null
}

const SIGNOFF = '— BabyClaw 🐾'

// One "• task (~duration)" line. Guards a malformed rock (opaque jsonb): no task text → no line.
function rockLine(rock: DispatchPlanRock): string | null {
  const task = rock.task?.trim()
  if (!task) return null
  const duration = rock.duration?.trim()
  return duration ? `• ${task} (${duration})` : `• ${task}`
}

// Active habits not yet done today — the 💪 section. Capped so the push body stays scannable.
function habitLines(inputs: DispatchInputs, cap = 8): string[] {
  return inputs.habits
    .filter((h) => h.active && !inputs.habit_done[h.id])
    .slice(0, cap)
    .map((h) => `• ${h.text}`)
}

/**
 * The morning push, from the day's actual plan — the EisenClaw-Telegram shape: greeting + headline,
 * then only the sections the plan actually filled (🪨 big rock / ⚡ quick wins / 💪 habits). A light
 * plan renders light: the prompt already treats "an open day is valid" as a first-class outcome, so
 * this formatter never pads — no rocks means headline + habits (or an explicit open-day line), not a
 * manufactured to-do list.
 */
export function buildMorningFromPlan(plan: DispatchPlan, inputs: DispatchInputs): MessageContent {
  const name = greetName(inputs)
  const title = `Good morning${name ? ` ${name}` : ''}! ☀️`

  const sections: string[] = []
  const headline = plan.headline?.trim()
  if (headline) sections.push(headline)

  const big = plan.bigRock ? rockLine(plan.bigRock) : null
  if (big) sections.push(`🪨 BIG ROCK\n${big}`)

  const quick = (plan.smallRocks ?? [])
    .map(rockLine)
    .filter((line): line is string => line !== null)
  if (quick.length > 0) sections.push(`⚡ QUICK WINS\n${quick.join('\n')}`)

  const habits = habitLines(inputs)
  if (habits.length > 0) sections.push(`💪 HABITS\n${habits.join('\n')}`)

  // A plan with no rocks IS the message ("open day") — say so plainly if the headline didn't.
  if (!big && quick.length === 0)
    sections.push('Nothing pressing on the board — enjoy the open day 🙂')

  sections.push(SIGNOFF)
  return { title, body: sections.join('\n\n') }
}

// The deterministic morning fallback — ships when no plan exists and AI is paused/failed, so the
// send never depends on the model. A load summary, not a fake plan.
export function buildMorningMessage(inputs: DispatchInputs): MessageContent {
  const name = greetName(inputs)
  const open = inputs.tasks.filter(
    (t) => !t.staged && !inputs.done[t.id] && t.x != null && t.y != null,
  )
  const habits = inputs.habits.filter((h) => h.active)
  const bits: string[] = []
  if (open.length > 0) bits.push(plural(open.length, 'task', 'tasks'))
  if (habits.length > 0) bits.push(plural(habits.length, 'habit', 'habits'))
  const load = bits.length > 0 ? `${bits.join(' and ')} on deck` : 'a clear slate'
  return {
    title: `Good morning${name ? ` ${name}` : ''}! ☀️`,
    body: `${load} today. Tap to plan your day.`,
  }
}

/**
 * The evening push — a check-in, not a stats dump. Built from that morning's plan: list its still-
 * unfinished items numbered and ask which got knocked out (the reply lands in chat, where BabyClaw
 * marks them done). Done-ness is matched by task text against today's done map; an item we can't
 * match stays on the list (better to ask than to silently drop). No plan on file → a gentle generic
 * check-in; everything finished → celebrate and stop. Rest days are always a fine answer.
 */
export function buildRecapMessage(inputs: DispatchInputs, dayName: string): MessageContent {
  const name = greetName(inputs)
  const greet = name ? `Hey ${name}! ` : ''

  const plan = inputs.plan
  const rocks: DispatchPlanRock[] = plan
    ? [...(plan.bigRock ? [plan.bigRock] : []), ...(plan.smallRocks ?? [])]
    : []
  const items = rocks.map((r) => r.task?.trim()).filter((t): t is string => Boolean(t))

  if (items.length === 0) {
    // No plan today (or an empty one): check in generally instead of pretending there was a list.
    const open = inputs.tasks.filter(
      (t) => !t.staged && !inputs.done[t.id] && t.x != null && t.y != null,
    )
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
  const doneTexts = new Set(inputs.tasks.filter((t) => inputs.done[t.id]).map((t) => t.text))
  const unfinished = items.filter((t) => !doneTexts.has(t))

  if (unfinished.length === 0) {
    return {
      title: `Wrapping up ${dayName} 🎉`,
      body: `${greet}You cleared the whole plan today — nicely done. Take the evening 🙂\n\n${SIGNOFF}`,
    }
  }

  const list = unfinished.map((t, i) => `${i + 1}. ${t}`).join('\n')
  return {
    title: `Wrapping up ${dayName} 👋`,
    body:
      `${greet}Which of these did you knock out today?\n\n${list}\n\n` +
      `Reply with the numbers or names and I'll mark them done. No worries if today was a rest day 🙂\n\n${SIGNOFF}`,
  }
}
