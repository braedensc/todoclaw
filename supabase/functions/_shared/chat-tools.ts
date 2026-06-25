// chat-tools.ts — the chat's user-scoped tools: definitions (sent to Anthropic), Zod input
// validation (defense-in-depth at execution), and executors. EVERY DB write goes through the
// CALLER's JWT client (ctx.client), so RLS applies and the model never supplies user_id — a
// prompt-injected instruction can at worst touch the caller's own rows. Destructive tools
// (complete_task, delete_task) are gated by a SERVER-SIDE set, never trusted from the model.

import { z } from 'npm:zod@4.4.3'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { localDateInTZ } from './dates.ts'
import { placeByDue, urgencyToX, importanceToY } from './placement.ts'

export interface ToolContext {
  client: SupabaseClient // caller-JWT-scoped → RLS applies
  timeZone: string // for complete_task's user-local date
  now?: Date
}

export interface ToolResult {
  content: string // narratable text fed back to the model as the tool_result
  is_error: boolean
}

// Destructive tools require explicit user confirmation before they execute. This is a
// SERVER-SIDE classification — the model's belief about it is irrelevant.
export const DESTRUCTIVE = new Set(['complete_task', 'delete_task'])

// ---- tool definitions (Anthropic input_schema) ----------------------------------------------
export const TOOL_DEFS = [
  {
    name: 'list_tasks',
    description:
      "List the user's current tasks (id, text, grid position, due date, staged, recurring). Use to refresh context before editing.",
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'create_task',
    description:
      'Create a new task. If a due date is given, the grid position is computed automatically; if not, the task is staged at the center for the user to place.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'The task text.' },
        due: { type: ['string', 'null'], description: 'ISO 8601 date (e.g. 2026-07-01) or null.' },
        recurring_frequency_days: {
          type: ['integer', 'null'],
          description: 'If it recurs, the cadence in days; else null.',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'move_task',
    description:
      'Reposition a task on the urgency (x) / importance (y) grid. Provide EITHER x and y (0..1) OR the word-based urgency/importance.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task_id: { type: 'string', description: 'The task id (UUID).' },
        x: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        y: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        urgency: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
        importance: { type: ['string', 'null'], enum: ['low', 'high', null] },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'set_due_date',
    description: "Set or clear a task's due date; the grid position follows the new due date.",
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task_id: { type: 'string' },
        due: { type: ['string', 'null'], description: 'ISO 8601 date, or null to clear.' },
      },
      required: ['task_id', 'due'],
    },
  },
  {
    name: 'make_recurring',
    description: 'Make a task recurring with a cadence in days.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task_id: { type: 'string' },
        frequency_days: { type: 'integer', minimum: 1 },
      },
      required: ['task_id', 'frequency_days'],
    },
  },
  {
    name: 'complete_task',
    description:
      'Mark a task done for today. Destructive — the user is asked to confirm before it runs.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'delete_task',
    description:
      'Move a task to the trash (soft-delete). Destructive — the user is asked to confirm before it runs.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
] as const

// ---- Zod input schemas (validated before any DB write) --------------------------------------
const uuid = z.string().uuid()
const SCHEMAS = {
  list_tasks: z.object({}).strict(),
  create_task: z.object({
    text: z.string().min(1),
    due: z.string().nullish(),
    recurring_frequency_days: z.number().int().positive().nullish(),
  }),
  move_task: z.object({
    task_id: uuid,
    x: z.number().min(0).max(1).nullish(),
    y: z.number().min(0).max(1).nullish(),
    urgency: z.enum(['low', 'medium', 'high']).nullish(),
    importance: z.enum(['low', 'high']).nullish(),
  }),
  set_due_date: z.object({ task_id: uuid, due: z.string().nullable() }),
  make_recurring: z.object({ task_id: uuid, frequency_days: z.number().int().positive() }),
  complete_task: z.object({ task_id: uuid }),
  delete_task: z.object({ task_id: uuid }),
} as const

// ---- executor -------------------------------------------------------------------------------
export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const schema = (SCHEMAS as Record<string, z.ZodTypeAny>)[name]
  if (!schema) return err(`Unknown tool: ${name}`)

  const parsed = schema.safeParse(rawInput ?? {})
  if (!parsed.success) return err(`Invalid arguments for ${name}: ${parsed.error.message}`)
  const input = parsed.data
  const now = ctx.now ?? new Date()

  try {
    switch (name) {
      case 'list_tasks': {
        const { data, error } = await ctx.client
          .from('tasks')
          .select('id, text, x, y, due, staged, recurring')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
        if (error) return err(error.message)
        return ok(JSON.stringify(data ?? []))
      }
      case 'create_task': {
        const i = input as z.infer<typeof SCHEMAS.create_task>
        const place = placeByDue(i.due ?? null, ctx.timeZone, now)
        const row: Record<string, unknown> = {
          text: i.text,
          x: place.x,
          y: place.y,
          staged: place.staged,
          due: i.due ?? null,
        }
        if (i.recurring_frequency_days) {
          row.recurring = {
            frequencyDays: i.recurring_frequency_days,
            lastDoneAt: null,
            doneCount: 0,
          }
        }
        const { data, error } = await ctx.client.from('tasks').insert(row).select('id').single()
        if (error) return err(error.message)
        return ok(
          `Created "${i.text}"${place.staged ? ' in the staging tray' : ' on the grid'} (id ${
            data.id
          }).`,
        )
      }
      case 'move_task': {
        const i = input as z.infer<typeof SCHEMAS.move_task>
        const x = i.x ?? (i.urgency ? urgencyToX(i.urgency) : undefined)
        const y = i.y ?? (i.importance ? importanceToY(i.importance) : undefined)
        if (x === undefined && y === undefined) {
          return err('Specify a position: x/y, or an urgency/importance word.')
        }
        const patch: Record<string, number | boolean> = { staged: false }
        if (x !== undefined) patch.x = x
        if (y !== undefined) patch.y = y
        return updateTask(ctx.client, i.task_id, patch, 'Moved')
      }
      case 'set_due_date': {
        const i = input as z.infer<typeof SCHEMAS.set_due_date>
        const place = placeByDue(i.due, ctx.timeZone, now)
        return updateTask(
          ctx.client,
          i.task_id,
          { due: i.due, x: place.x, y: place.y, staged: place.staged },
          i.due ? 'Set the due date for' : 'Cleared the due date for',
        )
      }
      case 'make_recurring': {
        const i = input as z.infer<typeof SCHEMAS.make_recurring>
        return updateTask(
          ctx.client,
          i.task_id,
          { recurring: { frequencyDays: i.frequency_days, lastDoneAt: null, doneCount: 0 } },
          'Made recurring',
        )
      }
      case 'complete_task': {
        const i = input as z.infer<typeof SCHEMAS.complete_task>
        const { data: task, error: selErr } = await ctx.client
          .from('tasks')
          .select('text, bucket')
          .eq('id', i.task_id)
          .is('deleted_at', null)
          .maybeSingle()
        if (selErr) return err(selErr.message)
        if (!task) return err('That task no longer exists.')
        const { error } = await ctx.client.rpc('set_task_done', {
          p_date: localDateInTZ(ctx.timeZone, now),
          p_task_id: i.task_id,
          p_text: task.text,
          p_bucket: task.bucket ?? null,
        })
        if (error) return err(error.message)
        return ok(`Marked "${task.text}" done for today.`)
      }
      case 'delete_task': {
        const i = input as z.infer<typeof SCHEMAS.delete_task>
        return updateTask(
          ctx.client,
          i.task_id,
          { deleted_at: new Date().toISOString() },
          'Moved to the trash',
        )
      }
      default:
        return err(`Unhandled tool: ${name}`)
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : 'tool failed')
  }
}

// Update a task by id under RLS; .select() confirms a row actually matched (a hallucinated id
// touches zero rows → a clear "not found" rather than a silent no-op).
async function updateTask(
  client: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
  verb: string,
): Promise<ToolResult> {
  const { data, error } = await client
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null)
    .select('text')
    .maybeSingle()
  if (error) return err(error.message)
  if (!data) return err("I couldn't find that task.")
  return ok(`${verb} "${data.text}".`)
}

const ok = (content: string): ToolResult => ({ content, is_error: false })
const err = (content: string): ToolResult => ({ content, is_error: true })

// A short human summary of a destructive tool call, shown in the confirmation dialog. The caller
// resolves the task text (from the seeded grid) for a friendly label; falls back to the id.
export function destructiveSummary(name: string, input: unknown, taskText?: string): string {
  const label = taskText
    ? `"${taskText}"`
    : `task ${(input as { task_id?: string })?.task_id ?? ''}`
  if (name === 'complete_task') return `Mark ${label} done for today`
  if (name === 'delete_task') return `Move ${label} to the trash`
  return `Run ${name}`
}
