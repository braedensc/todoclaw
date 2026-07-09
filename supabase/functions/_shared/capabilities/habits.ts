// capabilities/habits.ts — the habit capabilities (the biggest gap the chat had before). Habit
// rows carry an embedded `subtasks` jsonb array of {id,text}; step edits are a read-modify-write
// of that array (mirroring the client's useUpdateHabit path). Per-day check state (today's
// habit_done / subtask_done) is written through the atomic set_daily_flag RPC, never here.

import { z } from 'npm:zod@4.4.3'
import { localDateInTZ } from '../dates.ts'
import { defineCapability, type Capability } from './types.ts'
import { ok, err, systemErr, updateHabitRow, loadHabitSubtasks } from './helpers.ts'

const uuid = z.string().uuid()

export const habitCapabilities: Capability[] = [
  defineCapability({
    name: 'list_habits',
    description:
      "List the user's habits (id, text, whether active, and their steps). Use to refresh your view before editing habits.",
    schema: z.object({}).strict(),
    async execute(ctx) {
      const { data, error } = await ctx.client
        .from('habits')
        .select('id, text, active, subtasks')
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
      if (error) return systemErr(error.message)
      // Row dump is for the model's eyes only (ids for follow-up edits) — hidden from the user.
      return ok(JSON.stringify(data ?? []), undefined, null)
    },
  }),

  defineCapability({
    name: 'create_habit',
    description: 'Create a new daily habit. It starts active. Add steps separately if wanted.',
    schema: z.object({ text: z.string().min(1).max(2000).describe('The habit name.') }).strict(),
    async execute(ctx, i) {
      const { error } = await ctx.client.from('habits').insert({ text: i.text })
      if (error) return systemErr(error.message)
      return ok(`Added the habit "${i.text}".`, ['habits'])
    },
  }),

  defineCapability({
    name: 'rename_habit',
    description: 'Rename a habit.',
    schema: z
      .object({
        habit_id: uuid.describe('The habit id (UUID).'),
        text: z.string().min(1).max(2000).describe('The new habit name.'),
      })
      .strict(),
    async execute(ctx, i) {
      return updateHabitRow(ctx.client, i.habit_id, { text: i.text }, 'Renamed the habit to')
    },
  }),

  defineCapability({
    name: 'set_habit_active',
    description:
      'Activate a habit (show it in the daily list) or deactivate it (move it to the queued/paused list). Does not delete it.',
    schema: z
      .object({
        habit_id: uuid.describe('The habit id (UUID).'),
        active: z.boolean().describe('true = active, false = paused/queued.'),
      })
      .strict(),
    async execute(ctx, i) {
      return updateHabitRow(
        ctx.client,
        i.habit_id,
        { active: i.active },
        i.active ? 'Activated the habit' : 'Paused the habit',
      )
    },
  }),

  defineCapability({
    name: 'set_habit_done',
    description: "Check or uncheck a habit for TODAY. Only affects today's completion.",
    schema: z
      .object({
        habit_id: uuid.describe('The habit id (UUID).'),
        done: z.boolean().describe('true = checked for today, false = unchecked.'),
      })
      .strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      const habit = await loadHabitSubtasks(ctx.client, i.habit_id)
      if (!habit) return err("I couldn't find that habit.")
      const { error } = await ctx.client.rpc('set_daily_flag', {
        p_date: localDateInTZ(ctx.timeZone, now),
        p_map: 'habit_done',
        p_key: i.habit_id,
        p_value: i.done,
      })
      if (error) return systemErr(error.message)
      return ok(`Marked "${habit.text}" ${i.done ? 'done' : 'not done'} for today.`, [
        'daily_state',
      ])
    },
  }),

  defineCapability({
    name: 'add_habit_step',
    description: 'Add a step (subtask) to a habit.',
    schema: z
      .object({
        habit_id: uuid.describe('The habit id (UUID).'),
        text: z.string().min(1).max(2000).describe('The step text.'),
      })
      .strict(),
    async execute(ctx, i) {
      const habit = await loadHabitSubtasks(ctx.client, i.habit_id)
      if (!habit) return err("I couldn't find that habit.")
      const subtasks = [...habit.subtasks, { id: crypto.randomUUID(), text: i.text }]
      return updateHabitRow(ctx.client, i.habit_id, { subtasks }, `Added the step "${i.text}" to`)
    },
  }),

  defineCapability({
    name: 'rename_habit_step',
    description: 'Rename a step (subtask) of a habit.',
    schema: z
      .object({
        habit_id: uuid.describe('The habit id (UUID).'),
        step_id: z.string().min(1).max(2000).describe('The step id.'),
        text: z.string().min(1).max(2000).describe('The new step text.'),
      })
      .strict(),
    async execute(ctx, i) {
      const habit = await loadHabitSubtasks(ctx.client, i.habit_id)
      if (!habit) return err("I couldn't find that habit.")
      if (!habit.subtasks.some((s) => s.id === i.step_id)) return err("I couldn't find that step.")
      const subtasks = habit.subtasks.map((s) => (s.id === i.step_id ? { ...s, text: i.text } : s))
      return updateHabitRow(ctx.client, i.habit_id, { subtasks }, `Renamed a step in`)
    },
  }),

  defineCapability({
    name: 'remove_habit_step',
    description: 'Remove a step (subtask) from a habit.',
    schema: z
      .object({
        habit_id: uuid.describe('The habit id (UUID).'),
        step_id: z.string().min(1).max(2000).describe('The step id.'),
      })
      .strict(),
    async execute(ctx, i) {
      const habit = await loadHabitSubtasks(ctx.client, i.habit_id)
      if (!habit) return err("I couldn't find that habit.")
      const subtasks = habit.subtasks.filter((s) => s.id !== i.step_id)
      if (subtasks.length === habit.subtasks.length) return err("I couldn't find that step.")
      return updateHabitRow(ctx.client, i.habit_id, { subtasks }, `Removed a step from`)
    },
  }),

  defineCapability({
    name: 'set_habit_step_done',
    description: "Check or uncheck a habit STEP for TODAY. Only affects today's completion.",
    schema: z
      .object({
        habit_id: uuid.describe('The habit id (UUID).'),
        step_id: z.string().min(1).max(2000).describe('The step id.'),
        done: z.boolean().describe('true = checked for today, false = unchecked.'),
      })
      .strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      const habit = await loadHabitSubtasks(ctx.client, i.habit_id)
      if (!habit) return err("I couldn't find that habit.")
      if (!habit.subtasks.some((s) => s.id === i.step_id)) return err("I couldn't find that step.")
      const { error } = await ctx.client.rpc('set_daily_flag', {
        p_date: localDateInTZ(ctx.timeZone, now),
        p_map: 'subtask_done',
        p_key: `${i.habit_id}:${i.step_id}`,
        p_value: i.done,
      })
      if (error) return systemErr(error.message)
      return ok(`Marked a step of "${habit.text}" ${i.done ? 'done' : 'not done'} for today.`, [
        'daily_state',
      ])
    },
  }),

  defineCapability({
    name: 'delete_habit',
    description:
      'Delete a habit (soft-delete). Destructive — the user is asked to confirm before it runs.',
    destructive: true,
    schema: z.object({ habit_id: uuid.describe('The habit id (UUID).') }).strict(),
    async execute(ctx, i) {
      const now = ctx.now ?? new Date()
      return updateHabitRow(
        ctx.client,
        i.habit_id,
        { deleted_at: now.toISOString() },
        'Deleted the habit',
      )
    },
  }),
]
