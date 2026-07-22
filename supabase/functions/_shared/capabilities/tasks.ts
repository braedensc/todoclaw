// capabilities/tasks.ts — the task capabilities. Positions are computed server-side from a due
// date or urgency/importance words (../placement.ts); completion goes through the atomic
// daily_state RPCs (set_task_done / set_task_undone). Destructive tools (complete_task,
// delete_task) are flagged here — the adapter never trusts the model's belief about that.

import { z } from 'npm:zod@4.4.3'
import { localDateInTZ } from '../dates.ts'
import { formatOffset } from '../reminder-content.ts'
import { placeByDue, urgencyToX, importanceToY } from '../placement.ts'
import { loadReminderDefault } from '../reminder-default.ts'
import { defineCapability, type Capability, type CapabilityContext } from './types.ts'
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

// Mirror the app's add forms: a task that GAINS a due time gets the user's default reminder
// (Settings → Notifications; built-in 1 hour, or Off) applied automatically. Best-effort — the
// task write already landed, so a reminder hiccup must not fail (and re-run) the whole tool; it
// just goes unmentioned. Returns the applied offset, or null when the default is off / it failed.
async function applyDefaultReminder(
  ctx: CapabilityContext,
  taskId: string,
): Promise<number | null> {
  const def = await loadReminderDefault(ctx.client)
  if (def === null) return null
  const { data: fireAt, error } = await ctx.client.rpc('set_task_reminder', {
    p_task_id: taskId,
    p_offset_minutes: def,
  })
  if (error) return null
  // A default whose fire time is already past can never usefully fire (the sweep drops anything
  // over an hour late, and "1 hour before" a moment that already passed is a lie either way) —
  // take the row back out and stay quiet rather than promise a reminder that won't come. The RPC
  // returns the materialized fire_at for exactly this check.
  const now = ctx.now ?? new Date()
  if (typeof fireAt === 'string' && new Date(fireAt).getTime() <= now.getTime()) {
    await ctx.client.rpc('remove_task_reminder', { p_task_id: taskId, p_offset_minutes: def })
    return null
  }
  return def
}

// The model-facing note for an auto-applied default (it should know the reminder exists so it can
// adjust when the user asked for a different lead time), and the user-facing chat line.
const autoReminderNote = (minutes: number): string =>
  ` The user's default reminder (${reminderPhrase(minutes)}) was added automatically — use remove_reminder/set_reminder if they wanted a different lead time or none.`
const autoReminderDisplay = (minutes: number): string =>
  ` Reminder ${reminderPhrase(minutes)} (your default).`

// A bare wall-clock calendar day ('YYYY-MM-DD') — the shape `due` and `start_date` store. Model
// inputs are validated against this before they reach a `date` column so a malformed string gets a
// friendly error, not a Postgres cast failure.
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// "Aug 1" for a wall-clock day — pure UTC-noon date math (the string already IS the user's day).
function fmtDay(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${iso}T12:00:00Z`))
}

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
      "List the user's current tasks (id, text, grid position, due date/time, staged, recurring, an `ongoing` project flag, a `size` (S/M/L/XL or null), a `done` flag, and `paused_until` when the task is paused). Mirrors the grid: one-off tasks completed on a PRIOR day are excluded (permanently done), while a task completed TODAY is still listed with done=true so you can restore it. A PAUSED task (future start date) is listed with paused_until set — it is hidden from the user's board and plans until that date. Use to refresh your view before editing.",
    schema: z.object({}).strict(),
    async execute(ctx) {
      const now = ctx.now ?? new Date()
      const date = localDateInTZ(ctx.timeZone, now)
      const [tasksRes, dailyRes] = await Promise.all([
        ctx.client
          .from('tasks')
          .select(
            'id, text, x, y, due, due_time, staged, recurring, ongoing, size, completed_at, start_date',
          )
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
          size: t.size ?? null,
          done: !!t.completed_at || doneMap[t.id as string] === true,
          // Paused = dormant until this local date (null when live). The raw start_date isn't
          // echoed separately — a past start date is indistinguishable from none.
          paused_until:
            t.start_date && (t.start_date as string).slice(0, 10) > date
              ? (t.start_date as string).slice(0, 10)
              : null,
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
      "Create a new task and place it on the urgency×importance grid. YOU decide where it goes: set `urgency` and `importance` from what the task actually is. Judge importance by STAKES, not by the due date — a routine chore (dishes, vacuum, laundry) is LOW importance even when it's due today, while a consequential task (a deadline that matters, a health thing) is high. A due date, if given, only nudges URGENCY (sooner = more urgent) and never dictates importance. If you give neither urgency/importance nor a due date, the task is staged (unplaced) for the user to place. Ask about a due date first when it is unclear whether one is needed. A task created WITH a due time automatically gets the user's default reminder (their Settings choice; usually 1 hour before, possibly Off) — the confirmation tells you what was added, so adjust with set_reminder/remove_reminder if they asked for a specific lead time. Also estimate a rough size (S/M/L/XL) from the text when you reasonably can — it helps the daily planner gauge effort — but leave it off when unclear; never pester the user for it.",
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
        start_date: z
          .string()
          .nullish()
          .describe(
            "Optional ISO date (e.g. 2026-08-01) the task should START: until then it stays hidden from the board, daily plans, and reminders, then appears by itself that morning. Use when the user says a task can't begin until some date. Omit for a normal, immediately-visible task.",
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
      // Optional start (pause-until) date: validated here for a friendly error; a past/today date
      // is allowed and simply means "already started" (the task is live immediately).
      if (i.start_date) {
        if (!ISO_DAY_RE.test(i.start_date)) {
          return err("That start date didn't look right — use an ISO date like 2026-08-01.")
        }
        row.start_date = i.start_date
      }
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
      // Created WITH a due time → the user's default reminder is applied, exactly like the app's
      // add forms (null = default off, or the write failed — then it goes unmentioned).
      const auto = row.due_time ? await applyDefaultReminder(ctx, data.id as string) : null
      const dormant =
        typeof row.start_date === 'string' && row.start_date > localDateInTZ(ctx.timeZone, now)
      const where = dormant
        ? ` — paused until ${fmtDay(row.start_date as string)} (it joins the board that morning)`
        : staged
          ? ' — staged, waiting to be placed'
          : ' on the grid'
      // The model keeps the id (to chain an edit/move next); the user just sees the plain result.
      return ok(
        `Created "${i.text}"${where} (id ${data.id}).${auto === null ? '' : autoReminderNote(auto)}`,
        auto === null ? ['tasks'] : ['tasks', 'reminders'],
        `Created "${i.text}"${where}.${auto === null ? '' : autoReminderDisplay(auto)}`,
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
      "Set or clear a task's due date, and optionally a due TIME. A new due date re-derives the task's URGENCY (grid x) from how soon it is — importance is never touched — and places a staged task on the board; clearing a due date leaves the card exactly where it is. When the task FIRST gains a due time (and has no reminders yet), the user's default reminder is added automatically — the confirmation tells you what was added. Clearing the due date (or just the time) also removes the task's reminders — a reminder needs both. Set a time when the user names one, or when they want a reminder (a reminder needs a due time).",
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
      // Read the task first — the position rule and the default-reminder rule both depend on its
      // current state (did it already have a time?).
      const { data: task, error: selErr } = await ctx.client
        .from('tasks')
        .select('text, due_time')
        .eq('id', i.task_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (selErr) return systemErr(selErr.message)
      if (!task) return err("I couldn't find that task.")

      const patch: Record<string, unknown> = { due: i.due }
      if (i.due === null) {
        // Clearing a due date clears the time and moves NOTHING — the card keeps its spot, exactly
        // like the app's schedule editor. (The old behavior re-staged the card at center, silently
        // discarding a placement the user chose.)
        patch.due_time = null
      } else {
        // A new due date re-derives URGENCY (x) from how soon it is. Importance (y) is NEVER
        // touched — per the placement doctrine, a due date can't make a task matter more — and a
        // staged task joins the board with its stored (neutral) importance. (The old behavior
        // overwrote y to 0.75, contradicting the doctrine and the in-app schedule editor.)
        patch.x = placeByDue(i.due, ctx.timeZone, now).x
        patch.staged = false
        // due_time is three-way: a provided time is validated/set (null clears just the time);
        // undefined leaves the existing time alone.
        if (i.due_time !== undefined) {
          if (i.due_time === null) {
            patch.due_time = null
          } else {
            const dt = normalizeDueTime(i.due_time)
            if (!dt)
              return err("That time didn't look right — use 24-hour HH:MM, like 15:00 for 3 PM.")
            patch.due_time = dt
          }
        }
      }

      // Clearing the anchor (the date, or just the time off a timed task) makes the DB trigger
      // drop every reminder row — a reminder has nothing to fire from. Pre-check whether any exist
      // so the wipe is REPORTED (domain + note), not silently absorbed.
      let wipesReminders = false
      if (patch.due_time === null && task.due_time) {
        const { data: existing } = await ctx.client
          .from('task_reminders')
          .select('task_id')
          .eq('task_id', i.task_id)
        wipesReminders = ((existing as unknown[] | null) ?? []).length > 0
      }

      const result = await updateTaskRow(
        ctx.client,
        i.task_id,
        patch,
        i.due ? 'Set the due date for' : 'Cleared the due date for',
      )
      if (result.isError) return result

      if (wipesReminders) {
        return ok(
          `${result.content} Its reminders were removed too — a reminder needs a due date and time.`,
          ['tasks', 'reminders'],
          `${result.content} Its reminders were removed too.`,
        )
      }

      // The task just GAINED a due time (it had none) and holds no reminders → mirror the add
      // forms and apply the user's default. An already-timed task is left alone: an empty reminder
      // set there may mean "deliberately removed", which a date change must not undo.
      if (typeof patch.due_time === 'string' && !task.due_time) {
        const { data: existing, error: exErr } = await ctx.client
          .from('task_reminders')
          .select('task_id')
          .eq('task_id', i.task_id)
        if (!exErr && !(existing ?? []).length) {
          const auto = await applyDefaultReminder(ctx, i.task_id)
          if (auto !== null) {
            return ok(
              `${result.content}${autoReminderNote(auto)}`,
              ['tasks', 'reminders'],
              `${result.content}${autoReminderDisplay(auto)}`,
            )
          }
        }
      }
      return result
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
      'Remove ALL push reminders from a task (leaves the due date and time as they are). Every ' +
      "reminder is a lead-time offset before the task's due time; a recurring task's offsets " +
      'simply re-arm each occurrence — there is no separate alarm kind.',
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
    name: 'pause_task',
    description:
      'Pause a task until a future date: it disappears from the board, daily plans, the morning ' +
      'push, and its reminders are held — then it comes back BY ITSELF that morning, exactly where ' +
      'it was. Use when the user can\'t work on something until a known date ("pause the API ' +
      'project until Aug 1", "I can\'t touch this until my credits reset"). This also RESCHEDULES ' +
      'an already-paused task (the new date replaces the old). Not for finishing (complete_task) ' +
      'or removing (delete_task) — the task stays alive, just dormant.',
    schema: z
      .object({
        task_id: uuid.describe('The task id (UUID).'),
        until: z
          .string()
          .describe(
            "ISO date (e.g. 2026-08-01) the task should return on — must be after today. It wakes that morning in the user's timezone.",
          ),
      })
      .strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      if (!ISO_DAY_RE.test(i.until)) {
        return err("That date didn't look right — use an ISO date like 2026-08-01.")
      }
      const today = localDateInTZ(ctx.timeZone, now)
      if (i.until <= today) {
        return err(
          'That date is already here — pick a date after today, or leave the task as it is.',
        )
      }
      const { data: task, error: selErr } = await ctx.client
        .from('tasks')
        .select('text')
        .eq('id', i.task_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (selErr) return systemErr(selErr.message)
      if (!task) return err("I couldn't find that task.")
      const { error } = await ctx.client
        .from('tasks')
        .update({ start_date: i.until })
        .eq('id', i.task_id)
        .is('deleted_at', null)
      if (error) return systemErr(error.message)
      return ok(
        `Paused "${task.text}" until ${fmtDay(i.until)} — off the board and out of daily plans until then; it comes back that morning on its own.`,
        ['tasks'],
      )
    },
  }),

  defineCapability({
    name: 'resume_task',
    description:
      'Wake a PAUSED task early: clears its start date so it returns to the board right now, at ' +
      'its old spot. Use when the user wants a paused task back before its return date. (Paused ' +
      'tasks are the ones listed with paused_until.)',
    schema: z.object({ task_id: uuid.describe('The task id (UUID).') }).strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      const { data: task, error: selErr } = await ctx.client
        .from('tasks')
        .select('text, start_date')
        .eq('id', i.task_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (selErr) return systemErr(selErr.message)
      if (!task) return err("I couldn't find that task.")
      const paused =
        typeof task.start_date === 'string' &&
        task.start_date.slice(0, 10) > localDateInTZ(ctx.timeZone, now)
      if (!paused) return ok(`"${task.text}" isn't paused — it's already on the board.`, ['tasks'])
      const { error } = await ctx.client
        .from('tasks')
        .update({ start_date: null })
        .eq('id', i.task_id)
        .is('deleted_at', null)
      if (error) return systemErr(error.message)
      return ok(`Resumed "${task.text}" — it's back on the board.`, ['tasks'])
    },
  }),

  defineCapability({
    name: 'restore_task',
    description:
      "Un-complete a task so it returns to the active board — works for a task checked off today OR on a past day (it clears the completion marker; the permanent Done-log entry is never removed — that's delete_completion).",
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
      'Delete a task. There is NO trash surface in the app — the only recovery is restoring a ' +
      'Settings → Backups snapshot that still contains it, so never call deletion easily ' +
      'reversible. Destructive — the user is asked to confirm before it runs.',
    destructive: true,
    schema: z.object({ task_id: uuid.describe('The task id (UUID).') }).strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      return updateTaskRow(ctx.client, i.task_id, { deleted_at: now.toISOString() }, 'Deleted')
    },
  }),
]
