// chat-context.ts — assemble BabyClaw's per-request context from the caller's tables (RLS-scoped).
// Feeds chat-prompt.ts buildSystem: active + done-today tasks (full grid position), habits with
// today's check state, the schedule summary, and the per-user assistant config. Also returns a
// label map (task/habit id → text) for the destructive-confirmation summary. Reads defensively —
// every optional field has a fallback so a sparse profile never breaks the chat.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { dayNameInTZ, daysUntilInTZ, localDateInTZ } from './dates.ts'
import {
  DEFAULT_ASSISTANT_CONFIG,
  type AssistantConfig,
  type ChatContext,
  type PromptHabit,
  type PromptPlan,
  type PromptTask,
} from './chat-prompt.ts'

const MAX_CUSTOM_INSTRUCTIONS = 500

interface Recurring {
  frequencyDays: number
  lastDoneAt: string | null
  doneCount: number
  ongoing?: boolean
  targetEnd?: string | null
}

export interface LoadedChatContext {
  context: ChatContext
  timeZone: string
  labelById: Map<string, string> // task + habit id → text, for destructive-confirmation summaries
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

// Compact summary of today's saved Plan My Day (daily_state.plan jsonb, DayPlan shape — see
// src/types/plan.ts), read defensively so a malformed/partial plan never breaks the chat. Null when
// there's no plan today, so BabyClaw can answer "what's my big rock?" instead of being blind to it.
interface RawRock {
  task?: unknown
  duration?: unknown
  when?: unknown
}
export function planSummary(raw: unknown): PromptPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as { headline?: unknown; bigRock?: RawRock | null; smallRocks?: unknown }
  const rockLabel = (r: RawRock | null | undefined): string | null => {
    if (!r || typeof r.task !== 'string' || !r.task.trim()) return null
    const extra = [r.when, r.duration].filter(
      (x): x is string => typeof x === 'string' && !!x.trim(),
    )
    return extra.length ? `${r.task.trim()} (${extra.join(', ')})` : r.task.trim()
  }
  const headline = typeof p.headline === 'string' && p.headline.trim() ? p.headline.trim() : null
  const bigRock = rockLabel(p.bigRock)
  const smallRocks = (Array.isArray(p.smallRocks) ? p.smallRocks : [])
    .map((r) =>
      r && typeof (r as RawRock).task === 'string' ? ((r as RawRock).task as string) : '',
    )
    .map((t) => t.trim())
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

function scheduleSummary(config: Record<string, unknown> | null, dayOfWeek: string): string | null {
  if (!config) return null
  const bits: string[] = []
  if (typeof config.location === 'string') bits.push(`Location: ${config.location}.`)
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

  const [tasksRes, habitsRes, dailyRes, remindersRes] = await Promise.all([
    client
      .from('tasks')
      // completed_at is fetched (not SQL-filtered) so the render can mirror the grid/list split:
      // a one-off completion is excluded from ACTIVE regardless of day, yet a task completed TODAY
      // still surfaces under DONE TODAY (a prior-day completion, absent from today's done map, drops
      // out of both). Filtering it in SQL would also hide today's completions from DONE TODAY.
      .select('id, text, x, y, due, due_time, staged, recurring, completed_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    client
      .from('habits')
      .select('id, text, active, subtasks')
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
    client
      .from('daily_state')
      .select('done, habit_done, subtask_done, plan')
      .eq('date', date)
      .maybeSingle(),
    // Pending per-task reminders (sent_at null = not yet fired) so BabyClaw knows which tasks
    // already have one — otherwise it can't answer "do I have a reminder on X?" or reason about
    // adding another. One-off rows carry offset_minutes (a task may hold several); a recurring row
    // carries time_of_day (one per task, a fixed-cadence alarm).
    client
      .from('task_reminders')
      .select('task_id, offset_minutes, time_of_day')
      .is('sent_at', null),
  ])

  const doneMap = (dailyRes.data?.done ?? {}) as Record<string, boolean>
  const habitDone = (dailyRes.data?.habit_done ?? {}) as Record<string, boolean>
  const subtaskDone = (dailyRes.data?.subtask_done ?? {}) as Record<string, boolean>

  const reminderByTask = new Map<string, number[]>()
  const recurringReminderByTask = new Map<string, string>()
  for (const r of (remindersRes.data ?? []) as {
    task_id: string
    offset_minutes: number | null
    time_of_day: string | null
  }[]) {
    if (r.time_of_day != null) {
      recurringReminderByTask.set(r.task_id, r.time_of_day)
    } else if (r.offset_minutes != null) {
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
    const isOngoing = !!rec?.ongoing
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
      ongoing: isOngoing,
      ongoingSessions: isOngoing ? (rec?.doneCount ?? 0) : null,
      ongoingTargetInDays:
        isOngoing && rec?.targetEnd ? daysUntilInTZ(rec.targetEnd, timeZone, now) : null,
      reminderOffsets: reminderByTask.get(t.id as string) ?? [],
      recurringReminderTime: recurringReminderByTask.get(t.id as string) ?? null,
      doneToday: doneMap[t.id as string] === true,
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

  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(now)
  const today = fmt({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const dayOfWeek = dayNameInTZ(timeZone, now)

  const context: ChatContext = {
    today,
    timeZone,
    scheduleSummary: scheduleSummary(config, dayOfWeek),
    tasks,
    habits,
    plan: planSummary(dailyRes.data?.plan),
    assistant: parseAssistant(config),
  }

  return { context, timeZone, labelById }
}
