// capabilities/tasks.ts — the task capabilities. Positions are computed server-side from a due
// date or urgency/importance words (../placement.ts); completion goes through the atomic
// daily_state RPCs (set_task_done / set_task_undone). Destructive tools (complete_task,
// delete_task) are flagged here — the adapter never trusts the model's belief about that.

import { z } from 'npm:zod@4.4.3'
import { localDateInTZ } from '../dates.ts'
import { formatOffset } from '../reminder-content.ts'
import { placeByDue, urgencyToX, importanceToY } from '../placement.ts'
import { defineCapability, type Capability } from './types.ts'
import { ok, err, systemErr, updateTaskRow } from './helpers.ts'

const uuid = z.string().uuid()

// A local wall-clock due time (tasks.due_time, ADR due-dates-wall-clock). Accept 24-hour H:MM /
// HH:MM / HH:MM:SS (lenient on a single-digit hour so "9:30" isn't rejected), and normalize to a
// uniform HH:MM:SS. Returns null on anything malformed (bad hour, non-numeric) so the caller returns
// a friendly error instead of writing garbage into the `time` column.
function normalizeDueTime(t: string): string | null {
  const m = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(t.trim())
  if (!m) return null
  const hour = Number(m[1])
  if (hour > 23) return null
  return `${String(hour).padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}`
}

// "1 hour before" / "at the due time" — the confirmation phrase for a reminder offset.
const reminderPhrase = (minutes: number): string =>
  minutes === 0 ? 'at the due time' : `${formatOffset(minutes)} before`

// Format a completion instant (ISO from history.completed_at) in the user's zone, so BabyClaw can
// answer "when did I…" without doing timezone math on a raw UTC string itself.
function fmtInstant(iso: string, timeZone: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export const taskCapabilities: Capability[] = [
  defineCapability({
    name: 'list_tasks',
    description:
      "List the user's current tasks (id, text, grid position, due date/time, staged, recurring, an `ongoing` project flag, and a `done` flag). Mirrors the grid: one-off tasks completed on a PRIOR day are excluded (permanently done), while a task completed TODAY is still listed with done=true so you can restore it. Use to refresh your view before editing.",
    schema: z.object({}).strict(),
    async execute(ctx) {
      const now = ctx.now ?? new Date()
      const date = localDateInTZ(ctx.timeZone, now)
      const [tasksRes, dailyRes] = await Promise.all([
        ctx.client
          .from('tasks')
          .select('id, text, x, y, due, due_time, staged, recurring, ongoing, completed_at')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        ctx.client.from('daily_state').select('done').eq('date', date).maybeSingle(),
      ])
      if (tasksRes.error) return systemErr(tasksRes.error.message)
      const doneMap = (dailyRes.data?.done ?? {}) as Record<string, boolean>
      // Mirror the grid/list/mobile filter (!completed_at && !doneToday): drop tasks completed on a
      // prior day entirely, keep live tasks + today's completions, and tag each with a `done` flag so
      // the model never treats a finished task as active (completed_at itself stays out of the payload
      // — the flag is the actionable bit; search_history is where past completions live).
      const rows = (tasksRes.data ?? [])
        .filter((t) => !t.completed_at || doneMap[t.id as string] === true)
        .map((t) => ({
          id: t.id,
          text: t.text,
          x: t.x,
          y: t.y,
          due: t.due,
          due_time: t.due_time,
          staged: t.staged,
          recurring: t.recurring,
          ongoing: t.ongoing,
          done: !!t.completed_at || doneMap[t.id as string] === true,
        }))
      // The JSON goes to the model so it can reference ids; hide it from the user (display: null) —
      // a raw row dump isn't an "action that occurred", it's the model refreshing its view.
      return ok(JSON.stringify(rows), undefined, null)
    },
  }),

  defineCapability({
    name: 'search_history',
    description:
      'Search the permanent completion log (the Done tab) for one-off tasks the user has finished, newest first. Use when they ask WHEN or WHETHER they completed something in the past — e.g. "when was my last dentist visit?" or "did I ever finish the taxes?". Pass `query` to match words in the completed task text, or omit it for the most recent completions. NOTE: only one-off task completions are logged here — recurring tasks and habits are not, so say so if asked about those.',
    schema: z
      .object({
        query: z
          .string()
          .max(200)
          .nullish()
          .describe(
            'Words to match in the completed task text (case-insensitive substring). Omit for the most recent completions.',
          ),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .nullish()
          .describe('Max completions to return (default 20, max 50).'),
      })
      .strict(),
    async execute(ctx, i) {
      const limit = Math.min(i.limit ?? 20, 50)
      let q = ctx.client
        .from('history')
        .select('id, text, completed_at')
        .order('completed_at', { ascending: false })
        .limit(limit)
      const term = i.query?.trim()
      if (term) {
        // Escape LIKE metacharacters so a literal % or _ in the query can't act as a wildcard.
        const esc = term.replace(/[\\%_]/g, (c) => `\\${c}`)
        q = q.ilike('text', `%${esc}%`)
      }
      const { data, error } = await q
      if (error) return systemErr(error.message)
      // `id` is included so delete_completion can target a specific entry; it stays model-only
      // (display: null), never shown to the user, like every other id BabyClaw handles.
      const rows = (data ?? []).map((r) => ({
        id: r.id as string,
        text: r.text as string,
        completedAt: r.completed_at as string,
        when: fmtInstant(r.completed_at as string, ctx.timeZone),
      }))
      // Read-only lookup: JSON to the model, hidden from the user (display: null) — the answer comes
      // back in BabyClaw's own words, not a row dump.
      return ok(JSON.stringify(rows), undefined, null)
    },
  }),

  defineCapability({
    name: 'delete_completion',
    description:
      'Permanently remove ONE entry from the Done log (the same as the × on a Done-tab row). Look up the entry id with search_history first. This only deletes the completion RECORD — it does not affect the live task. Destructive — the user is asked to confirm before it runs.',
    destructive: true,
    schema: z
      .object({ completion_id: uuid.describe('The Done-log entry id (UUID) from search_history.') })
      .strict(),
    async execute(ctx, i) {
      // Owner-scoped DELETE (history_delete_own policy); .select() confirms a row actually matched so
      // a stale/hallucinated id becomes a clear not-found instead of a silent no-op.
      const { data, error } = await ctx.client
        .from('history')
        .delete()
        .eq('id', i.completion_id)
        .select('text')
        .maybeSingle()
      if (error) return systemErr(error.message)
      if (!data) return err("I couldn't find that entry in your Done log.")
      return ok(`Removed "${data.text}" from your Done log.`, ['history'])
    },
  }),

  defineCapability({
    name: 'create_task',
    description:
      "Create a new task and place it on the urgency×importance grid. YOU decide where it goes: set `urgency` and `importance` from what the task actually is. Judge importance by STAKES, not by the due date — a routine chore (dishes, vacuum, laundry) is LOW importance even when it's due today, while a consequential task (a deadline that matters, a health thing) is high. A due date, if given, only nudges URGENCY (sooner = more urgent) and never dictates importance. If you give neither urgency/importance nor a due date, the task is staged at center for the user to place. Ask about a due date first when it is unclear whether one is needed. Also estimate a rough size (S/M/L/XL) from the text when you reasonably can — it helps the daily planner gauge effort — but leave it off when unclear; never pester the user for it.",
    schema: z
      .object({
        text: z.string().min(1).max(2000).describe('The task text.'),
        due: z
          .string()
          .nullish()
          .describe('ISO 8601 date (e.g. 2026-07-01) or null for no due date.'),
        due_time: z
          .string()
          .nullish()
          .describe(
            'Optional local wall-clock time in 24-hour HH:MM (e.g. "15:00" for 3 PM) to anchor the due date to a specific time. Set this when the user names a time, or when they want a reminder — a reminder needs a due time. Requires a due date; omit for an all-day task.',
          ),
        urgency: z
          .enum(['low', 'medium', 'high'])
          .nullish()
          .describe(
            'How urgent — the horizontal axis. Set it from the task itself; a soon due date makes something more urgent but is not required. Omit only when you genuinely cannot tell (a due date will then set urgency, else it stays staged).',
          ),
        importance: z
          .enum(['low', 'medium', 'high'])
          .nullish()
          .describe(
            'How high-stakes — the vertical axis. Judge from what the task IS, never from its due date: a routine chore is low even when due today; something consequential is high. Omit only when you genuinely cannot tell (it then defaults to neutral, never high).',
          ),
        size: z
          .enum(['S', 'M', 'L', 'XL'])
          .nullish()
          .describe(
            'Rough effort estimate: S ≈ 15m, M ≈ 45m, L ≈ 2h, XL ≈ half-day. Infer from the task text; omit or null if genuinely unclear.',
          ),
        recurring_frequency_days: z
          .number()
          .int()
          .positive()
          .nullish()
          .describe('If it recurs (a repeating chore), the cadence in days; else null.'),
        ongoing: z
          .boolean()
          .nullish()
          .describe(
            'Set true ONLY for an ONGOING PROJECT — a standing, open-ended effort worked on over many sessions (e.g. "redesign the site", "study for the bar"), NOT a one-off or a quick chore. It behaves like a normal task (an optional, usually far-out due date) but the planner proactively suggests chipping away at it. Mutually exclusive with recurring_frequency_days. Omit/false otherwise.',
          ),
      })
      .strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      // Placement is BabyClaw-decided: the urgency/importance it chose win. A due date only informs
      // URGENCY (days-until-due → x, via placeByDue) and NEVER importance — importance defaults to
      // neutral, not high, so setting a due date can't slam a routine task into the important half
      // (the old placeByDue behavior). A task with no placement signal at all stays staged.
      const due = i.due ?? null
      const x = i.urgency ? urgencyToX(i.urgency) : due ? placeByDue(due, ctx.timeZone, now).x : 0.5
      const y = i.importance ? importanceToY(i.importance) : 0.5
      const staged = !i.urgency && !i.importance && !due
      const row: Record<string, unknown> = {
        text: i.text,
        x,
        y,
        staged,
        due,
      }
      // A due time only makes sense with a due date (the wall-clock model anchors the time TO a day).
      // Validate + normalize; reject a malformed time or a time with no date so nothing bad is stored.
      if (i.due_time) {
        if (!due) return err('A due time needs a due date too — give me a date and the time.')
        const dt = normalizeDueTime(i.due_time)
        if (!dt) return err("That time didn't look right — use 24-hour HH:MM, like 15:00 for 3 PM.")
        row.due_time = dt
      }
      // Only write a size when the model supplied one; otherwise the column stays NULL and Plan My
      // Day infers effort at plan time (the "hybrid" half of the sizing model).
      if (i.size) row.size = i.size
      // An ongoing project is a standalone flag (no recurring data); it takes precedence over a
      // plain recurring cadence, which otherwise makes an ordinary repeating chore.
      if (i.ongoing) {
        row.ongoing = true
      } else if (i.recurring_frequency_days) {
        row.recurring = {
          frequencyDays: i.recurring_frequency_days,
          lastDoneAt: null,
          doneCount: 0,
        }
      }
      const { data, error } = await ctx.client.from('tasks').insert(row).select('id').single()
      if (error) return systemErr(error.message)
      const where = staged ? ' in the staging tray' : ' on the grid'
      // The model keeps the id (to chain an edit/move next); the user just sees the plain result.
      return ok(
        `Created "${i.text}"${where} (id ${data.id}).`,
        ['tasks'],
        `Created "${i.text}"${where}.`,
      )
    },
  }),

  defineCapability({
    name: 'edit_task_text',
    description: 'Rename a task (change its text). Does not change its position or due date.',
    schema: z
      .object({
        task_id: uuid.describe('The task id (UUID).'),
        text: z.string().min(1).max(2000).describe('The new task text.'),
      })
      .strict(),
    async execute(ctx, i) {
      return updateTaskRow(ctx.client, i.task_id, { text: i.text }, 'Renamed to')
    },
  }),

  defineCapability({
    name: 'move_task',
    description:
      'Reposition a task on the urgency (x) / importance (y) grid. Provide EITHER x and y (0..1) OR the word-based urgency/importance.',
    schema: z
      .object({
        task_id: uuid.describe('The task id (UUID).'),
        x: z.number().min(0).max(1).nullish().describe('Urgency 0 (left) → 1 (right).'),
        y: z.number().min(0).max(1).nullish().describe('Importance 0 (bottom) → 1 (top).'),
        urgency: z.enum(['low', 'medium', 'high']).nullish(),
        importance: z.enum(['low', 'medium', 'high']).nullish(),
      })
      .strict(),
    async execute(ctx, i) {
      const x = i.x ?? (i.urgency ? urgencyToX(i.urgency) : undefined)
      const y = i.y ?? (i.importance ? importanceToY(i.importance) : undefined)
      if (x === undefined && y === undefined) {
        return err('Specify a position: x/y, or an urgency/importance word.')
      }
      const patch: Record<string, number | boolean> = { staged: false }
      if (x !== undefined) patch.x = x
      if (y !== undefined) patch.y = y
      return updateTaskRow(ctx.client, i.task_id, patch, 'Moved')
    },
  }),

  defineCapability({
    name: 'set_due_date',
    description:
      "Set or clear a task's due date, and optionally a due TIME; the grid position follows the new due date. Set a time when the user names one, or when they want a reminder (a reminder needs a due time).",
    schema: z
      .object({
        task_id: uuid.describe('The task id (UUID).'),
        due: z.string().nullable().describe('ISO 8601 date, or null to clear.'),
        due_time: z
          .string()
          .nullish()
          .describe(
            'Optional local wall-clock time in 24-hour HH:MM (e.g. "15:00" for 3 PM), or null to clear just the time. Omit to leave the existing time unchanged. Clearing the due date clears the time too.',
          ),
      })
      .strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      const place = placeByDue(i.due, ctx.timeZone, now)
      const patch: Record<string, unknown> = {
        due: i.due,
        x: place.x,
        y: place.y,
        staged: place.staged,
      }
      // due_time is three-way: clearing the date clears the time; else a provided time is
      // validated/set (or null clears just the time); undefined leaves the existing time alone.
      if (i.due === null) {
        patch.due_time = null
      } else if (i.due_time !== undefined) {
        if (i.due_time === null) {
          patch.due_time = null
        } else {
          const dt = normalizeDueTime(i.due_time)
          if (!dt)
            return err("That time didn't look right — use 24-hour HH:MM, like 15:00 for 3 PM.")
          patch.due_time = dt
        }
      }
      return updateTaskRow(
        ctx.client,
        i.task_id,
        patch,
        i.due ? 'Set the due date for' : 'Cleared the due date for',
      )
    },
  }),

  defineCapability({
    name: 'set_reminder',
    description:
      'Add a push reminder for a task a given number of minutes before it is due. The task must ' +
      'already have a due date AND a due time (use set_due_date first if not). Works for RECURRING ' +
      "tasks too: the reminder leads each occurrence — it fires that far before the task's due time " +
      'on its cadence, then re-arms for the next cycle. A task can have several reminders at ' +
      'different lead times (e.g. 1 day AND 1 hour before), each firing on its own; call this once ' +
      'per lead time. Setting the same lead time again just re-arms it. Reminders arrive on devices ' +
      'where the user has notifications turned on.',
    schema: z
      .object({
        task_id: uuid.describe('The task id (UUID).'),
        minutes_before: z
          .number()
          .int()
          .min(0)
          .max(40320)
          .describe(
            'Minutes before the due time to fire (0 = at the due time; max 40320 = 28 days).',
          ),
      })
      .strict(),
    async execute(ctx, i) {
      // Pre-check for friendly messages (the RPC re-validates all of this as a backstop). RLS
      // scopes the select to the caller's own live tasks.
      const { data: task, error: selErr } = await ctx.client
        .from('tasks')
        .select('text, due, due_time, recurring')
        .eq('id', i.task_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (selErr) return systemErr(selErr.message)
      if (!task) return err("I couldn't find that task.")
      if (!task.due || !task.due_time) {
        return err(
          `"${task.text}" needs a due date and time before I can set a reminder — set those first, then ask again.`,
        )
      }
      // Recurring is allowed now: set_task_reminder anchors the reminder to each occurrence and
      // returns the next FUTURE fire (so the stale check below never trips for a recurring task).
      // set_task_reminder returns the materialized fire_at so we can flag an already-past lead time.
      const { data: fireAt, error } = await ctx.client.rpc('set_task_reminder', {
        p_task_id: i.task_id,
        p_offset_minutes: i.minutes_before,
      })
      if (error) return systemErr(error.message)
      // If the lead time already elapsed beyond the sweep's freshness window (60 min), it won't
      // fire — say so rather than falsely confirming.
      const now = ctx.now ?? new Date()
      const stale =
        typeof fireAt === 'string' && new Date(fireAt).getTime() < now.getTime() - 60 * 60 * 1000
      const base = `Set a reminder ${reminderPhrase(i.minutes_before)} for "${task.text}".`
      return ok(
        stale
          ? `${base} Heads up — that lead time is already in the past, so it won't fire; try a shorter one.`
          : base,
        ['reminders'],
      )
    },
  }),

  defineCapability({
    name: 'clear_reminder',
    description:
      'Remove ALL push reminders from a task, of either kind — one-off lead times or a recurring ' +
      'time-of-day alarm (leaves the due date and time as they are).',
    schema: z.object({ task_id: uuid.describe('The task id (UUID).') }).strict(),
    async execute(ctx, i) {
      const { data: task, error: selErr } = await ctx.client
        .from('tasks')
        .select('text')
        .eq('id', i.task_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (selErr) return systemErr(selErr.message)
      if (!task) return err("I couldn't find that task.")
      // Were there any reminders to remove? (RLS-scoped) — so the confirmation doesn't claim a
      // removal that never happened. A task can have several rows, so read the set (no maybeSingle,
      // which would throw on more than one) and check it's non-empty.
      const { data: existing, error: exErr } = await ctx.client
        .from('task_reminders')
        .select('task_id')
        .eq('task_id', i.task_id)
      if (exErr) return systemErr(exErr.message)
      const hadReminder = Array.isArray(existing) ? existing.length > 0 : existing != null
      if (!hadReminder) return ok(`"${task.text}" didn't have a reminder set.`, ['reminders'])
      const { error } = await ctx.client.rpc('clear_task_reminder', { p_task_id: i.task_id })
      if (error) return systemErr(error.message)
      return ok(`Removed the reminders from "${task.text}".`, ['reminders'])
    },
  }),

  defineCapability({
    name: 'remove_reminder',
    description:
      'Remove ONE push reminder from a task by its lead time (minutes before due), leaving any ' +
      'other reminders on that task in place. Use this when a task has several reminders and the ' +
      'user wants to drop just one; use clear_reminder to remove them all at once.',
    schema: z
      .object({
        task_id: uuid.describe('The task id (UUID).'),
        minutes_before: z
          .number()
          .int()
          .min(0)
          .max(40320)
          .describe('The lead time to remove (0 = at the due time; max 40320 = 28 days).'),
      })
      .strict(),
    async execute(ctx, i) {
      const { data: task, error: selErr } = await ctx.client
        .from('tasks')
        .select('text')
        .eq('id', i.task_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (selErr) return systemErr(selErr.message)
      if (!task) return err("I couldn't find that task.")
      const lead = i.minutes_before === 0 ? 'at-due-time' : formatOffset(i.minutes_before)
      // Was that specific lead time set? (RLS-scoped) — so the confirmation is honest about
      // whether anything was actually removed.
      const { data: existing, error: exErr } = await ctx.client
        .from('task_reminders')
        .select('task_id')
        .eq('task_id', i.task_id)
        .eq('offset_minutes', i.minutes_before)
      if (exErr) return systemErr(exErr.message)
      const hadIt = Array.isArray(existing) ? existing.length > 0 : existing != null
      if (!hadIt) return ok(`"${task.text}" didn't have a ${lead} reminder set.`, ['reminders'])
      const { error } = await ctx.client.rpc('remove_task_reminder', {
        p_task_id: i.task_id,
        p_offset_minutes: i.minutes_before,
      })
      if (error) return systemErr(error.message)
      return ok(`Removed the ${lead} reminder from "${task.text}".`, ['reminders'])
    },
  }),

  defineCapability({
    name: 'make_recurring',
    description:
      'Make a task recurring with a cadence in days. Retuning the cadence of an already-recurring task keeps its progress (last-done and count); it does not reset the clock.',
    schema: z
      .object({
        task_id: uuid.describe('The task id (UUID).'),
        frequency_days: z.number().int().min(1).describe('Cadence in days.'),
      })
      .strict(),
    async execute(ctx, i) {
      const { data: task, error: selErr } = await ctx.client
        .from('tasks')
        .select('recurring')
        .eq('id', i.task_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (selErr) return systemErr(selErr.message)
      if (!task) return err("I couldn't find that task.")
      // Preserve an existing cycle when only changing cadence (mirrors the list's onSetFrequency),
      // so a retune doesn't snap the task back to "never done". A fresh recurrence starts at null.
      const prev = task.recurring as { lastDoneAt?: string | null; doneCount?: number } | null
      // Clear `ongoing` in the same write: the two types are mutually exclusive (DB CHECK), so
      // promoting an ongoing project to a recurring chore must drop the flag or the update is rejected.
      return updateTaskRow(
        ctx.client,
        i.task_id,
        {
          recurring: {
            frequencyDays: i.frequency_days,
            lastDoneAt: prev?.lastDoneAt ?? null,
            doneCount: prev?.doneCount ?? 0,
          },
          ongoing: false,
        },
        'Made recurring',
      )
    },
  }),

  defineCapability({
    name: 'make_ongoing',
    description:
      'Mark a task as an ONGOING PROJECT — a standing, open-ended effort worked on over many sessions (e.g. "redesign the website", "study for the bar exam", "learn Spanish"). It behaves like a normal task (it stays on the board with an optional, usually far-out due date), but the daily planner proactively suggests chipping away at it, and it is completed with an ordinary complete_task when it is actually done. Use this ONLY for a genuine long-running effort — NOT for one-off tasks or quick chores (a due date or make_recurring fits those).',
    schema: z.object({ task_id: uuid.describe('The task id (UUID).') }).strict(),
    async execute(ctx, i) {
      // Ongoing is a standalone flag; clearing `recurring` in the same write keeps the two types
      // mutually exclusive (DB CHECK), so promoting a chore to a project drops its cadence.
      return updateTaskRow(
        ctx.client,
        i.task_id,
        { ongoing: true, recurring: null },
        'Made ongoing',
      )
    },
  }),

  defineCapability({
    name: 'clear_recurring',
    description:
      'Stop a task from recurring OR from being an ongoing project — make it an ordinary one-off task again.',
    schema: z.object({ task_id: uuid.describe('The task id (UUID).') }).strict(),
    async execute(ctx, i) {
      return updateTaskRow(
        ctx.client,
        i.task_id,
        { recurring: null, ongoing: false },
        'Stopped recurring',
      )
    },
  }),

  defineCapability({
    name: 'restore_task',
    description:
      "Un-complete a task that was marked done TODAY, putting it back on the active list. (Only affects today's completion; the permanent history log is never changed.)",
    schema: z.object({ task_id: uuid.describe('The task id (UUID).') }).strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      const { data: task, error: selErr } = await ctx.client
        .from('tasks')
        .select('text')
        .eq('id', i.task_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (selErr) return systemErr(selErr.message)
      if (!task) return err('That task no longer exists.')
      const { error } = await ctx.client.rpc('set_task_undone', {
        p_date: localDateInTZ(ctx.timeZone, now),
        p_task_id: i.task_id,
      })
      if (error) return systemErr(error.message)
      return ok(`Restored "${task.text}" to your active tasks.`, ['daily_state'])
    },
  }),

  defineCapability({
    name: 'complete_task',
    description:
      'Mark a task done for today. For a recurring chore this advances its cycle (it comes back next interval); for a one-off task or an ONGOING project it archives the task to the Done log. Destructive — the user is asked to confirm before it runs.',
    destructive: true,
    schema: z.object({ task_id: uuid.describe('The task id (UUID).') }).strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      const { data: task, error: selErr } = await ctx.client
        .from('tasks')
        .select('text, bucket, recurring')
        .eq('id', i.task_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (selErr) return systemErr(selErr.message)
      if (!task) return err('That task no longer exists.')

      // A recurring CHORE is completed by ADVANCING its cycle (lastDoneAt + doneCount), never through
      // set_task_done — exactly what the grid/list "Done" does (handleDoneRecurring). set_task_done
      // would stamp tasks.completed_at, which hides the task permanently and freezes the recurrence.
      // A one-off task and an ONGOING project both fall through to set_task_done (done = archived).
      const rec = task.recurring as {
        frequencyDays?: number
        lastDoneAt?: string | null
        doneCount?: number
      } | null
      if (rec?.frequencyDays) {
        const patch = {
          recurring: { ...rec, lastDoneAt: now.toISOString(), doneCount: (rec.doneCount ?? 0) + 1 },
        }
        const { error } = await ctx.client
          .from('tasks')
          .update(patch)
          .eq('id', i.task_id)
          .is('deleted_at', null)
          .select('text')
          .maybeSingle()
        if (error) return systemErr(error.message)
        return ok(`Checked off recurring "${task.text}" — back on its cycle.`, ['tasks'])
      }

      const { error } = await ctx.client.rpc('set_task_done', {
        p_date: localDateInTZ(ctx.timeZone, now),
        p_task_id: i.task_id,
        p_text: task.text,
        p_bucket: task.bucket ?? null,
      })
      if (error) return systemErr(error.message)
      return ok(`Marked "${task.text}" done for today.`, ['daily_state', 'history'])
    },
  }),

  defineCapability({
    name: 'delete_task',
    description:
      'Move a task to the trash (soft-delete). Destructive — the user is asked to confirm before it runs.',
    destructive: true,
    schema: z.object({ task_id: uuid.describe('The task id (UUID).') }).strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      return updateTaskRow(
        ctx.client,
        i.task_id,
        { deleted_at: now.toISOString() },
        'Moved to the trash',
      )
    },
  }),
]
