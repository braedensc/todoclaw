// chat-context.ts — assemble BabyClaw's per-request context from the caller's tables (RLS-scoped).
// Feeds chat-prompt.ts buildSystem: active + done-today tasks (full grid position), habits with
// today's check state, the schedule summary, and the per-user assistant config. Also returns a
// label map (task/habit id → text) for the destructive-confirmation summary. Reads defensively —
// every optional field has a fallback so a sparse profile never breaks the chat.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { dayNameInTZ, daysUntilInTZ, localDateInTZ } from './dates.ts'
import { reminderDefaultFromConfig } from './reminder-default.ts'
import { HABITS_FETCH_LIMIT, REMINDERS_FETCH_LIMIT, TASKS_FETCH_LIMIT } from './write-caps.ts'
import {
  DEFAULT_ASSISTANT_CONFIG,
  type AssistantConfig,
  type ChatContext,
  type PromptHabit,
  type PromptMemory,
  type PromptPlan,
  type PromptTask,
} from './chat-prompt.ts'

const MAX_CUSTOM_INSTRUCTIONS = 500
const MAX_MEMORY_CHARS = 240

interface Recurring {
  frequencyDays: number
  lastDoneAt: string | null
  doneCount: number
}

export interface LoadedChatContext {
  context: ChatContext
  timeZone: string
  labelById: Map<string, string> // task + habit + memory id → text, for destructive-confirm summaries
  memoryEnabled: boolean // false ⇒ ai-chat filters out the memory tools + the block is omitted
}

// Cadence label (mirrors src/lib/recurring.ts fmtFrequency).
function fmtFrequency(days: number): string {
  if (days <= 3) return `every ${days}d`
  if (days === 7) return 'weekly'
  if (days <= 13) return `every ${days}d`
  if (days === 14) return 'every 2wk'
  if (days === 21) return 'every 3wk'
  if (days <= 32) return 'monthly'
  if (days <= 42) return 'every ~5wk'
  if (days <= 65) return 'every ~2mo'
  return 'every ~3mo'
}

// Due/overdue phrase for a recurring task (mirrors src/lib/recurring.ts recurringStatus thresholds),
// so BabyClaw can tell an overdue chore from one that isn't due yet — a recurring task never sits in
// the daily done map, so without this it would read every recurrence as an active to-do.
function recurringStatusPhrase(rec: Recurring | null, now: Date): string | null {
  if (!rec || !rec.frequencyDays) return null
  if (rec.lastDoneAt == null) return 'never done'
  const daysSince = Math.floor((now.getTime() - Date.parse(rec.lastDoneAt)) / 86_400_000)
  const daysLeft = rec.frequencyDays - daysSince
  if (daysLeft < -1) return `overdue ${Math.abs(daysLeft)}d`
  if (daysLeft <= 0) return 'due today'
  if (daysLeft === 1) return 'due tomorrow'
  return `due again in ${daysLeft}d`
}

// A recurring task never touches the daily done map — completing it just resets recurring.lastDoneAt
// — so the grid/mobile board hides it for the rest of the local day by comparing lastDoneAt to today
// (src/lib/recurring.ts recurringDoneToday). Mirror that here so BabyClaw's context matches what the
// user sees: a recurring chore ticked off today reads as DONE TODAY, not as still-active.
function recurringDoneToday(rec: Recurring | null, timeZone: string, now: Date): boolean {
  if (!rec?.lastDoneAt) return false
  return localDateInTZ(timeZone, new Date(rec.lastDoneAt)) === localDateInTZ(timeZone, now)
}

// Compact summary of today's saved Plan My Day (daily_state.plan jsonb, DayPlan shape — see
// src/types/plan.ts), read defensively so a malformed/partial plan never breaks the chat. Null when
// there's no plan today, so BabyClaw can answer "what's my big rock?" instead of being blind to it.
// Rocks whose task is already completed are prefixed "✓ " (the PLAN block header explains the mark)
// so an evening conversation never nudges the user toward something they already finished. Matched
// by the rock's taskId (stamped at generation) first, exact task text as the legacy fallback.
interface RawRock {
  task?: unknown
  duration?: unknown
  when?: unknown
  taskId?: unknown
}
export function planSummary(
  raw: unknown,
  tasks: { id: string; text: string; doneToday: boolean; completedAt: string | null }[] = [],
): PromptPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as { headline?: unknown; bigRock?: RawRock | null; smallRocks?: unknown }
  const doneIds = new Set<string>()
  const doneTexts = new Set<string>()
  for (const t of tasks) {
    // Id match takes completed_at too (precise); text fallback sticks to done-TODAY so an old
    // completion of a same-named task can't strike a live plan item.
    if (t.doneToday || t.completedAt) doneIds.add(t.id)
    if (t.doneToday) doneTexts.add(t.text.trim())
  }
  const rockDone = (r: RawRock | null | undefined): boolean =>
    !!r &&
    ((typeof r.taskId === 'string' && doneIds.has(r.taskId)) ||
      (typeof r.task === 'string' && doneTexts.has(r.task.trim())))
  const rockLabel = (r: RawRock | null | undefined): string | null => {
    if (!r || typeof r.task !== 'string' || !r.task.trim()) return null
    const extra = [r.when, r.duration].filter(
      (x): x is string => typeof x === 'string' && !!x.trim(),
    )
    const base = extra.length ? `${r.task.trim()} (${extra.join(', ')})` : r.task.trim()
    return rockDone(r) ? `✓ ${base}` : base
  }
  const headline = typeof p.headline === 'string' && p.headline.trim() ? p.headline.trim() : null
  const bigRock = rockLabel(p.bigRock)
  const smallRocks = (Array.isArray(p.smallRocks) ? p.smallRocks : [])
    .map((r) => {
      const rock = r as RawRock | null
      if (!rock || typeof rock.task !== 'string' || !rock.task.trim()) return ''
      return rockDone(rock) ? `✓ ${rock.task.trim()}` : rock.task.trim()
    })
    .filter((t) => t.length > 0)
  if (!headline && !bigRock && smallRocks.length === 0) return null
  return { headline, bigRock, smallRocks }
}

function parseAssistant(config: Record<string, unknown> | null): AssistantConfig {
  // `config.assistant` is canonical (both the Settings editor and set_assistant_preference write
  // it). Fall back to the legacy `config.babyclaw` key the Settings editor wrote before the two
  // vocabularies were unified (2026-07-09); remove the fallback once no stored config carries it.
  const raw = (config?.assistant ?? config?.babyclaw ?? {}) as Record<string, unknown>
  const tone =
    raw.tone === 'playful' || raw.tone === 'neutral' || raw.tone === 'direct'
      ? raw.tone
      : DEFAULT_ASSISTANT_CONFIG.tone
  // Legacy 'normal' (pre-unification set_assistant_preference) → 'balanced'.
  const v = raw.verbosity === 'normal' ? 'balanced' : raw.verbosity
  const verbosity = v === 'balanced' || v === 'detailed' ? v : DEFAULT_ASSISTANT_CONFIG.verbosity
  let customInstructions: string | null = null
  if (typeof raw.customInstructions === 'string' && raw.customInstructions.trim()) {
    customInstructions = raw.customInstructions.slice(0, MAX_CUSTOM_INSTRUCTIONS)
  }
  return { tone, verbosity, customInstructions }
}

// First of `vals` that's a non-blank string, trimmed; null if none. Guards against a jsonb key that
// is absent, null, blank, or (defensively — this config is user-shaped) not a string at all.
function firstText(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function scheduleSummary(config: Record<string, unknown> | null, dayOfWeek: string): string | null {
  if (!config) return null
  const bits: string[] = []
  // Prefer the CONFIRMED place (what wttr.in's geocoder matched — see resolve-location) over the
  // raw typed string. It's canonical, so it disambiguates the Portlands instead of leaving the
  // model to guess; it's the place the plan's weather line actually describes, so the two can't
  // contradict each other; and a typo'd string ("Portlnad, OR") is noise the model may invent
  // around. Falls back to the raw text for configs written before locationResolved existed, or
  // where the lookup never succeeded — those still get today's behavior, just unconfirmed.
  const place = firstText(config.locationResolved, config.location)
  if (place) bits.push(`Location: ${place}.`)
  const isWeekend = dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday'
  const weekday = (config.weekday ?? {}) as Record<string, unknown>
  const weekend = (config.weekend ?? {}) as Record<string, Record<string, unknown>>
  const ds = isWeekend
    ? ((dayOfWeek === 'Sunday' ? weekend.sunday : weekend.saturday) ?? {})
    : weekday
  const freeHours = ds.freeTimeEstimateHours
  if (typeof freeHours === 'number') bits.push(`~${freeHours}h free today.`)
  const commitments = Array.isArray(config.commitments) ? config.commitments : []
  const fixed = commitments
    .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>) : null))
    .filter(
      (c): c is Record<string, unknown> => !!c && typeof c.label === 'string' && !!c.label.trim(),
    )
    .map((c) => {
      const label = (c.label as string).trim()
      const when =
        typeof c.when === 'string' && c.when.trim() ? ` (${(c.when as string).trim()})` : ''
      return `${label}${when}`
    })
  if (fixed.length) {
    bits.push(`Fixed commitments: ${fixed.join(', ')} — already on the calendar, never a task.`)
  }
  return bits.length ? `Schedule: ${bits.join(' ')}` : null
}

export async function loadChatContext(
  client: SupabaseClient,
  now: Date = new Date(),
): Promise<LoadedChatContext> {
  const { data: sched } = await client
    .from('user_schedule')
    .select('timezone, config')
    .maybeSingle()
  const timeZone = (sched?.timezone as string) ?? 'UTC'
  const config = (sched?.config ?? null) as Record<string, unknown> | null
  const date = localDateInTZ(timeZone, now)

  // Kill switch: memory is on unless config.assistant.memoryEnabled === false. When off, skip the
  // fetch entirely (no block rendered) and signal ai-chat to filter out the memory tools.
  const assistantCfg = (config?.assistant ?? {}) as Record<string, unknown>
  const memoryEnabled = assistantCfg.memoryEnabled !== false

  const [tasksRes, habitsRes, dailyRes, remindersRes, memoriesRes] = await Promise.all([
    client
      .from('tasks')
      // completed_at is fetched (not SQL-filtered) so the render can mirror the grid/list split:
      // a one-off completion is excluded from ACTIVE regardless of day, yet a task completed TODAY
      // still surfaces under DONE TODAY (a prior-day completion, absent from today's done map, drops
      // out of both). Filtering it in SQL would also hide today's completions from DONE TODAY.
      .select(
        'id, text, x, y, due, due_time, staged, recurring, ongoing, size, completed_at, start_date',
      )
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      // Bounded fetch (write-caps.ts): the prompt renders far fewer, and an account at the DB row
      // caps must not balloon this function's memory or the model window.
      .limit(TASKS_FETCH_LIMIT),
    client
      .from('habits')
      .select('id, text, active, subtasks')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(HABITS_FETCH_LIMIT),
    client
      .from('daily_state')
      .select('done, habit_done, subtask_done, plan')
      .eq('date', date)
      .maybeSingle(),
    // Pending per-task reminders (sent_at null = not yet fired) so BabyClaw knows which tasks
    // already have one — otherwise it can't answer "do I have a reminder on X?" or reason about
    // adding another. Every row carries offset_minutes (a task may hold several); a recurring task's
    // reminders lead each occurrence, a one-off's lead the single due instant (same rows either way).
    client
      .from('task_reminders')
      .select('task_id, offset_minutes')
      .is('sent_at', null)
      .order('created_at', { ascending: true })
      .limit(REMINDERS_FETCH_LIMIT),
    // Saved memories (oldest-first = a stable prompt order), only when memory is on. ≤30 rows by
    // the DB trigger, so no limit needed. RLS scopes it to the caller.
    memoryEnabled
      ? client
          .from('assistant_memories')
          .select('id, content, updated_at')
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ])

  const doneMap = (dailyRes.data?.done ?? {}) as Record<string, boolean>
  const habitDone = (dailyRes.data?.habit_done ?? {}) as Record<string, boolean>
  const subtaskDone = (dailyRes.data?.subtask_done ?? {}) as Record<string, boolean>

  const reminderByTask = new Map<string, number[]>()
  for (const r of (remindersRes.data ?? []) as {
    task_id: string
    offset_minutes: number | null
  }[]) {
    if (r.offset_minutes != null) {
      const list = reminderByTask.get(r.task_id)
      if (list) list.push(r.offset_minutes)
      else reminderByTask.set(r.task_id, [r.offset_minutes])
    }
  }
  for (const list of reminderByTask.values()) list.sort((a, b) => a - b)

  const labelById = new Map<string, string>()

  const tasks: PromptTask[] = (tasksRes.data ?? []).map((t) => {
    const rec = t.recurring as Recurring | null
    labelById.set(t.id as string, t.text as string)
    return {
      id: t.id as string,
      text: t.text as string,
      x: t.x as number | null,
      y: t.y as number | null,
      due: t.due as string | null,
      dueInDays: daysUntilInTZ(t.due as string | null, timeZone, now),
      dueTime: t.due_time as string | null,
      staged: t.staged as boolean,
      recurringLabel: rec?.frequencyDays ? fmtFrequency(rec.frequencyDays) : null,
      recurringStatus: recurringStatusPhrase(rec, now),
      ongoing: (t.ongoing as boolean | null) ?? false,
      size: (t.size as string | null) ?? null,
      // Dormant (paused) = future start date on the user's local calendar. BabyClaw still SEES a
      // paused task — labeled, in its own PAUSED block — so "what's paused?" and resume work from
      // chat, while it stays out of ACTIVE and out of generated plans.
      pausedUntil:
        t.start_date && (t.start_date as string).slice(0, 10) > date
          ? (t.start_date as string).slice(0, 10)
          : null,
      reminderOffsets: reminderByTask.get(t.id as string) ?? [],
      // A one-off is done via the daily done map; a recurring chore is done via lastDoneAt=today
      // (it never enters the map) — count either so a recurring task ticked off today leaves ACTIVE
      // and reads as DONE TODAY, exactly as the grid/mobile board hides it.
      doneToday: doneMap[t.id as string] === true || recurringDoneToday(rec, timeZone, now),
      completedAt: (t.completed_at as string | null) ?? null,
    }
  })

  const habits: PromptHabit[] = (habitsRes.data ?? []).map((h) => {
    const id = h.id as string
    labelById.set(id, h.text as string)
    const steps = (Array.isArray(h.subtasks) ? h.subtasks : []) as { id: string; text: string }[]
    return {
      id,
      text: h.text as string,
      active: h.active as boolean,
      doneToday: habitDone[id] === true,
      steps: steps.map((s) => ({
        id: s.id,
        text: s.text,
        doneToday: subtaskDone[`${id}:${s.id}`] === true,
      })),
    }
  })

  // Saved memories → PromptMemory. Register each id → content in labelById so a delete_memory
  // confirmation shows the note's text, not a raw id. Read defensively (skip a malformed row).
  const memories: PromptMemory[] = []
  for (const m of (memoriesRes.data ?? []) as Record<string, unknown>[]) {
    if (typeof m.id !== 'string' || typeof m.content !== 'string' || !m.content) continue
    labelById.set(m.id, m.content)
    memories.push({
      id: m.id,
      content: m.content.slice(0, MAX_MEMORY_CHARS),
      savedOn: localDateInTZ(timeZone, new Date((m.updated_at as string) ?? now)),
    })
  }

  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(now)
  const today = fmt({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const dayOfWeek = dayNameInTZ(timeZone, now)

  const context: ChatContext = {
    today,
    timeZone,
    scheduleSummary: scheduleSummary(config, dayOfWeek),
    reminderDefault: reminderDefaultFromConfig(config),
    tasks,
    habits,
    plan: planSummary(dailyRes.data?.plan, tasks),
    assistant: parseAssistant(config),
    memories,
  }

  return { context, timeZone, labelById, memoryEnabled }
}
