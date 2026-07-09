// chat-tools.ts — the thin ANTHROPIC ADAPTER over the transport-agnostic capability registry
// (./capabilities/). It does three things and nothing else:
//   1. TOOL_DEFS — turn each capability into an Anthropic tool (JSON Schema derived from the
//      capability's zod schema via z.toJSONSchema, so there is no second hand-kept schema to drift).
//   2. executeTool — validate input against the zod schema (defense-in-depth at execution) and run
//      the capability, returning the model-facing text + which data domains it mutated.
//   3. destructiveSummary — the human confirmation label for a destructive tool.
// EVERY DB write still goes through the caller's JWT client (ctx.client) → RLS applies and the
// model never supplies user_id. A future MCP server consumes the SAME registry via its own adapter.

import type Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import { z } from 'npm:zod@4.4.3'
import { CAPABILITIES, capabilityByName, DESTRUCTIVE } from './capabilities/registry.ts'
import type { CapabilityContext, MutationDomain } from './capabilities/types.ts'

// Re-exported so ai-chat's imports are stable across the refactor.
export type ToolContext = CapabilityContext
export { DESTRUCTIVE }

export interface ToolResult {
  content: string // narratable text fed back to the model as the tool_result (may carry ids / JSON)
  is_error: boolean
  mutated?: MutationDomain[] // domains changed → drives the client's live-refresh
  // User-facing chat line: undefined → reuse `content`, null → hide the tool from the user. Keeps
  // ids / raw JSON / zod-validation dumps out of the chat panel. See CapabilityResult.display.
  display?: string | null
}

// Derive an Anthropic input_schema from a capability's zod schema. z.toJSONSchema emits a
// draft-07 document; Anthropic wants the bare object schema, so drop the top-level $schema key.
function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>
  delete js.$schema
  return js
}

export const TOOL_DEFS = CAPABILITIES.map((c) => ({
  name: c.name,
  description: c.description,
  input_schema: toInputSchema(c.schema),
})) as unknown as Anthropic.Tool[]

// Validate then execute. Unknown tool or invalid arguments fail here, BEFORE any DB call, and are
// surfaced to the model as an error tool_result (never a throw).
export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  // Adapter-level failures below keep a detailed `content` for the model to self-correct, but show
  // the user a generic `display` — a zod dump or a raw exception message is debug text, not chat.
  const cap = capabilityByName.get(name)
  if (!cap) {
    return { content: `Unknown tool: ${name}`, is_error: true, display: 'Something went wrong.' }
  }

  const parsed = cap.schema.safeParse(rawInput ?? {})
  if (!parsed.success) {
    return {
      content: `Invalid arguments for ${name}: ${parsed.error.message}`,
      is_error: true,
      display: "Sorry — I couldn't do that.",
    }
  }

  try {
    const res = await cap.execute(ctx, parsed.data)
    return {
      content: res.content,
      is_error: res.isError,
      mutated: res.mutated,
      display: res.display,
    }
  } catch (e) {
    return {
      content: e instanceof Error ? e.message : 'tool failed',
      is_error: true,
      display: 'Something went wrong.',
    }
  }
}

// A short human summary of a destructive tool call, shown in the confirmation dialog. `label`
// (resolved by the caller from the seeded task/habit snapshot) makes it friendly; falls back to
// the id. task_id (tasks) and habit_id (habits) are both handled.
export function destructiveSummary(name: string, input: unknown, label?: string): string {
  const id =
    (input as { task_id?: string; habit_id?: string })?.task_id ??
    (input as { habit_id?: string })?.habit_id ??
    ''
  if (name === 'complete_task') return `Mark ${label ? `"${label}"` : `task ${id}`} done for today`
  if (name === 'delete_task') return `Move ${label ? `"${label}"` : `task ${id}`} to the trash`
  if (name === 'delete_habit') return `Delete the habit ${label ? `"${label}"` : id}`
  return `Run ${name}`
}
