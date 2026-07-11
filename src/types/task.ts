import { z } from 'zod'

// Recurring-task shape, stored as jsonb on the task row (planning/EISENCLAW-LOGIC-TO-PORT.md
// §9, html:123). `frequencyDays` = cadence; `lastDoneAt` = ISO timestamp of last completion
// (null until first done); `doneCount` = total completions (drives the `×N` badge at >= 3).
//
// An ONGOING PROJECT (a continuous multi-week effort, e.g. "redesign the site") reuses this SAME
// engine rather than adding a new field/table: `frequencyDays` becomes the check-in cadence (how
// often it resurfaces), `lastDoneAt` the last work session, `doneCount` the session count. Two
// optional keys distinguish it from a chore — `ongoing: true` (reads as a project, not a repeat)
// and `targetEnd` (an optional 'YYYY-MM-DD' target finish, in the user's timezone like `due`).
// Both are jsonb keys, so no migration is needed and every pre-ongoing row/test parses unchanged:
// absent `ongoing` ⇒ the original chore behavior. An ongoing task ENDS via an explicit Finish
// (archived to history like a one-off), which a plain recurring chore never has.
export const RecurringSchema = z.object({
  frequencyDays: z.number(),
  lastDoneAt: z.string().nullable(),
  doneCount: z.number(),
  ongoing: z.boolean().optional(),
  targetEnd: z.string().nullable().optional(),
})

export type Recurring = z.infer<typeof RecurringSchema>

// Coarse effort estimate — a soft, optional signal read ONLY by Plan My Day (as a guardrail
// against over-stuffing a day), never shown in the task UI. Set by BabyClaw/MCP at creation;
// NULL/absent means unestimated (the planner infers effort). The S/M/L/XL → hours mapping lives
// with its consumer (supabase/functions/_shared/plan-prompt.ts), not here.
export const TASK_SIZES = ['S', 'M', 'L', 'XL'] as const
export const TaskSizeSchema = z.enum(TASK_SIZES)
export type TaskSize = z.infer<typeof TaskSizeSchema>

// One source of truth: the Zod schema validates rows at the Supabase boundary and
// its inferred type IS the app's Task type. Mirrors supabase/migrations/*_create_tasks.sql.
// date / time / timestamptz / jsonb come back over the wire as strings / parsed JSON.
export const TaskSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  text: z.string(),
  x: z.number().nullable(),
  y: z.number().nullable(),
  // Wall-clock due, in the user's timezone (ADR 2026-07-08-due-dates-wall-clock): `due` is a
  // floating 'YYYY-MM-DD' calendar date; `due_time` an optional 'HH:MM:SS' time-of-day, only
  // meaningful with `due` set. Neither is an instant — project via dueInstant() at the edges.
  due: z.string().nullable(),
  due_time: z.string().nullable(),
  staged: z.boolean(),
  // Only the 'oneoff' bucket exists (planning/EISENCLAW-LOGIC-TO-PORT.md, Discrepancy #8).
  // Nullable because Stage 1 rows were inserted without a bucket (the column has no default
  // yet). `recurring` is null for non-recurring tasks.
  bucket: z.literal('oneoff').nullable(),
  recurring: RecurringSchema.nullable(),
  // Optional+nullable (not required): a soft, additive field. `.nullish()` keeps task fixtures and
  // any pre-migration client (Vercel/Supabase deploy skew) parsing cleanly when `size` is absent.
  size: TaskSizeSchema.nullish(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
  // When a one-off (non-recurring) task was completed. null = live. PERMANENT (unlike the
  // per-day daily_state.done map, which resets at local midnight) — set by set_task_done,
  // cleared by set_task_undone (Restore). It's what keeps a completed task off the grid across
  // days. Recurring tasks never set this (they reset recurring.lastDoneAt instead).
  completed_at: z.string().nullable(),
})

export type Task = z.infer<typeof TaskSchema>
