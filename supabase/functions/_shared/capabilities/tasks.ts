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

// "1 hour before" / "at the due time" — the confirmation phrase for a reminder offset.
const reminderPhrase = (minutes: number): string =>
  minutes === 0 ? 'at the due time' : `${formatOffset(minutes)} before`

export const taskCapabilities: Capability[] = [
  defineCapability({
    name: 'list_tasks',
    description:
      "List the user's current tasks (id, text, grid position, due date, staged, recurring). Use to refresh your view before editing.",
    schema: z.object({}).strict(),
    async execute(ctx) {
      const { data, error } = await ctx.client
        .from('tasks')
        .select('id, text, x, y, due, staged, recurring')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (error) return systemErr(error.message)
      // The JSON goes to the model so it can reference ids; hide it from the user (display: null) —
      // a raw row dump isn't an "action that occurred", it's the model refreshing its view.
      return ok(JSON.stringify(data ?? []), undefined, null)
    },
  }),

  defineCapability({
    name: 'create_task',
    description:
      'Create a new task. If a due date is given, the grid position is computed automatically (sooner = more urgent); if not, the task is staged at center for the user to place. Ask about a due date first when it is unclear whether one is needed. Also estimate a rough size (S/M/L/XL) from the text when you reasonably can — it helps the daily planner gauge effort — but leave it off when unclear; never pester the user for it.',
    schema: z
      .object({
        text: z.string().min(1).max(2000).describe('The task text.'),
        due: z
          .string()
          .nullish()
          .describe('ISO 8601 date (e.g. 2026-07-01) or null for no due date.'),
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
          .describe('If it recurs, the cadence in days; else null.'),
      })
      .strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      const place = placeByDue(i.due ?? null, ctx.timeZone, now)
      const row: Record<string, unknown> = {
        text: i.text,
        x: place.x,
        y: place.y,
        staged: place.staged,
        due: i.due ?? null,
      }
      // Only write a size when the model supplied one; otherwise the column stays NULL and Plan My
      // Day infers effort at plan time (the "hybrid" half of the sizing model).
      if (i.size) row.size = i.size
      if (i.recurring_frequency_days) {
        row.recurring = {
          frequencyDays: i.recurring_frequency_days,
          lastDoneAt: null,
          doneCount: 0,
        }
      }
      const { data, error } = await ctx.client.from('tasks').insert(row).select('id').single()
      if (error) return systemErr(error.message)
      const where = place.staged ? ' in the staging tray' : ' on the grid'
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
        importance: z.enum(['low', 'high']).nullish(),
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
    description: "Set or clear a task's due date; the grid position follows the new due date.",
    schema: z
      .object({
        task_id: uuid.describe('The task id (UUID).'),
        due: z.string().nullable().describe('ISO 8601 date, or null to clear.'),
      })
      .strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      const place = placeByDue(i.due, ctx.timeZone, now)
      return updateTaskRow(
        ctx.client,
        i.task_id,
        { due: i.due, x: place.x, y: place.y, staged: place.staged },
        i.due ? 'Set the due date for' : 'Cleared the due date for',
      )
    },
  }),

  defineCapability({
    name: 'set_reminder',
    description:
      'Set a push reminder for a task a given number of minutes before it is due. The task must ' +
      'already have a due date AND a due time (use set_due_date first if not). Replaces any ' +
      'existing reminder on that task. Reminders arrive on devices where the user has ' +
      'notifications turned on.',
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
      if (task.recurring) {
        return err(
          `"${task.text}" is a recurring task — reminders aren't delivered for repeats. Set one on a one-off task instead.`,
        )
      }
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
    description: 'Remove the push reminder from a task (leaves the due date and time as they are).',
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
      // Was there a reminder to remove? (RLS-scoped) — so the confirmation doesn't claim a
      // removal that never happened.
      const { data: existing, error: exErr } = await ctx.client
        .from('task_reminders')
        .select('task_id')
        .eq('task_id', i.task_id)
        .maybeSingle()
      if (exErr) return systemErr(exErr.message)
      if (!existing) return ok(`"${task.text}" didn't have a reminder set.`, ['reminders'])
      const { error } = await ctx.client.rpc('clear_task_reminder', { p_task_id: i.task_id })
      if (error) return systemErr(error.message)
      return ok(`Removed the reminder from "${task.text}".`, ['reminders'])
    },
  }),

  defineCapability({
    name: 'make_recurring',
    description: 'Make a task recurring with a cadence in days.',
    schema: z
      .object({
        task_id: uuid.describe('The task id (UUID).'),
        frequency_days: z.number().int().min(1).describe('Cadence in days.'),
      })
      .strict(),
    async execute(ctx, i) {
      return updateTaskRow(
        ctx.client,
        i.task_id,
        { recurring: { frequencyDays: i.frequency_days, lastDoneAt: null, doneCount: 0 } },
        'Made recurring',
      )
    },
  }),

  defineCapability({
    name: 'clear_recurring',
    description: 'Stop a task from recurring (make it a one-off again).',
    schema: z.object({ task_id: uuid.describe('The task id (UUID).') }).strict(),
    async execute(ctx, i) {
      return updateTaskRow(ctx.client, i.task_id, { recurring: null }, 'Stopped recurring')
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
      'Mark a task done for today. Destructive — the user is asked to confirm before it runs.',
    destructive: true,
    schema: z.object({ task_id: uuid.describe('The task id (UUID).') }).strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      const { data: task, error: selErr } = await ctx.client
        .from('tasks')
        .select('text, bucket')
        .eq('id', i.task_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (selErr) return systemErr(selErr.message)
      if (!task) return err('That task no longer exists.')
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
