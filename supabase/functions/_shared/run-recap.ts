// run-recap.ts — the Anthropic call for the AI evening recap. Mirrors run-plan.ts generatePlan:
// build the prompt, force emit_recap, return the body + token usage. Unlike generatePlan it
// PERSISTS NOTHING — the dispatcher enriches the already-claimed message with the returned body.
// The model arrives EXPLICITLY from the caller (the dispatcher's cfg.planModel — the recap rides
// the plan knob, just as it shares the plan_my_day feature key). Throws if the model returns no
// tool use or an empty body (the caller falls back to the deterministic recap on any throw).

import type Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import { MAX_TOKENS } from './anthropic.ts'
import {
  RECAP_SYSTEM_PROMPT,
  EMIT_RECAP_TOOL,
  buildRecapUserPrompt,
  type RecapRequest,
} from './recap-prompt.ts'

export async function generateRecap(
  a: Anthropic,
  req: RecapRequest,
  model: string,
): Promise<{
  body: string
  usage: { input: number; output: number; cacheWrite: number; cacheRead: number }
}> {
  const msg = await a.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    // Fully static system prompt (all dynamic content is in the user message): one ephemeral
    // breakpoint (5-min TTL) caches tools + system together, shared across the dispatcher's
    // whole evening batch. Mirrors run-plan.ts.
    system: [{ type: 'text', text: RECAP_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildRecapUserPrompt(req) }],
    tools: [EMIT_RECAP_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: 'tool', name: 'emit_recap' },
  })
  const toolUse = msg.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('The recap writer did not return a message.')
  }
  const body = String((toolUse.input as { body?: unknown }).body ?? '').trim()
  if (!body) throw new Error('The recap writer returned an empty message.')
  return {
    body,
    usage: {
      input: msg.usage.input_tokens,
      output: msg.usage.output_tokens,
      cacheWrite: msg.usage.cache_creation_input_tokens ?? 0,
      cacheRead: msg.usage.cache_read_input_tokens ?? 0,
    },
  }
}
