// count-prefixes.ts — measure the REAL cached-prefix size of each AI surface against each
// allowlisted model's minimum cacheable prompt length (the "cache floor"), via the FREE
// /v1/messages/count_tokens endpoint. A prefix below the floor makes that surface's
// cache_control breakpoint a silent no-op on that model: no error, no cache entry, no
// discount — accounting stays correct, the savings are just 0.
//
//   npm run eval:prefixes
//
// Why this exists: the prompt-caching PR (#369) put a 5-min-TTL breakpoint on each surface's
// stable prefix (tools + system), but the floors are MODEL-specific and token counts are
// TOKENIZER-specific (Sonnet 5's tokenizer yields ~30% more tokens than 4.6-era models for the
// same text), so a chars/3.5 estimate cannot settle whether e.g. a Haiku plan prefix actually
// caches. This script renders the exact production prefixes and asks the API.
//
// LOCAL-ONLY and ZERO-COST: count_tokens bills nothing. It needs only EVAL_ANTHROPIC_API_KEY
// (the dedicated eval key — never the app key) and does NOT need the local Supabase stack:
// counting is a pure API call over rendered strings.
//
// What is measured, mirroring each production request shape exactly:
//  - chat (ai-chat/index.ts): TOOL_DEFS + buildSystemBlocks(ctx)[0] — the cached block
//    (SYSTEM_PREFIX + USER PREFERENCES + SAVED MEMORY). BOTH memoryEnabled variants: memory off
//    drops the memory tools from TOOL_DEFS and renders no SAVED MEMORY block.
//  - plan (run-plan.ts): SYSTEM_PROMPT + EMIT_PLAN_TOOL.
//  - recap (run-recap.ts): RECAP_SYSTEM_PROMPT + EMIT_RECAP_TOOL (recap rides the plan knob).
// Each surface is counted against its own model allowlist (guardrails-constants.ts).
//
// The raw count includes a few tokens of framing (a 1-char user message + message scaffolding);
// a bare same-model count is subtracted so the reported number is the tools+system prefix alone.

import Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import { TOOL_DEFS } from '../../supabase/functions/_shared/chat-tools.ts'
import { MEMORY_TOOL_NAMES } from '../../supabase/functions/_shared/capabilities/memories.ts'
import {
  buildSystemBlocks,
  DEFAULT_ASSISTANT_CONFIG,
  type ChatContext,
  type PromptMemory,
} from '../../supabase/functions/_shared/chat-prompt.ts'
import { EMIT_PLAN_TOOL, SYSTEM_PROMPT } from '../../supabase/functions/_shared/plan-prompt.ts'
import {
  EMIT_RECAP_TOOL,
  RECAP_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/recap-prompt.ts'
import {
  ALLOWED_CHAT_MODELS,
  ALLOWED_PLAN_MODELS,
} from '../../supabase/functions/_shared/guardrails-constants.ts'

// Minimum cacheable prompt length per model (API fact, not a repo constant — prefixes shorter
// than this silently don't cache). Verified 2026-08-21 against the prompt-caching docs.
const CACHE_FLOOR_TOKENS: Record<string, number> = {
  'claude-haiku-4-5': 4096,
  'claude-sonnet-5': 1024,
  'claude-opus-5': 512,
}

const key = Deno.env.get('EVAL_ANTHROPIC_API_KEY')
if (!key) {
  console.log('EVAL_ANTHROPIC_API_KEY is not set — nothing was measured.')
  console.log('count_tokens is free, but it still needs a key. Export the dedicated eval key')
  console.log('(see evals/README.md, "Setup") and re-run:  npm run eval:prefixes')
  Deno.exit(1)
}
const client = new Anthropic({ apiKey: key })

// Representative per-user data for the memory-ON variant of the chat prefix. Saved memories sit
// INSIDE the cached block (stable per user across turns), so a typical handful belongs in the
// measurement; sizes here match ordinary use, not the 240-char sanitizer cap.
const FIXTURE_MEMORIES: PromptMemory[] = [
  'Prefers deep-work blocks in the morning; meetings stacked after lunch.',
  'Training for a half marathon in October — long runs on Saturdays.',
  "Partner's birthday is November 12; likes to plan something a week ahead.",
  'Works from home Tuesdays and Thursdays.',
  'Tends to underestimate errands — pad anything involving the car.',
  'Studying for a cloud certification; wants quiet-evening nudges to review flashcards.',
].map((content, i) => ({ id: `mem-${i + 1}`, content, savedOn: '2026-08-01' }))

// buildSystemBlocks reads only ctx.assistant and ctx.memories for block 1 (the cached block);
// the rest of the context feeds the uncached volatile tail and can be empty here.
function chatContext(memories: PromptMemory[]): ChatContext {
  return {
    today: 'Thursday, August 21, 2026',
    nowTime: '9:30 AM',
    timeZone: 'America/New_York',
    scheduleSummary: null,
    reminderDefault: 60,
    tasks: [],
    habits: [],
    plan: null,
    assistant: DEFAULT_ASSISTANT_CONFIG,
    memories,
    activity: [],
  }
}

function chatStableBlock(memories: PromptMemory[]): string {
  return buildSystemBlocks(chatContext(memories))[0].text
}

interface Surface {
  name: string
  models: readonly string[]
  system: string
  tools: Anthropic.Tool[]
}

const memoryOffTools = TOOL_DEFS.filter((t) => !MEMORY_TOOL_NAMES.has(t.name))

const SURFACES: Surface[] = [
  {
    name: 'chat (memory on)',
    models: ALLOWED_CHAT_MODELS,
    system: chatStableBlock(FIXTURE_MEMORIES),
    tools: TOOL_DEFS,
  },
  {
    name: 'chat (memory off)',
    models: ALLOWED_CHAT_MODELS,
    system: chatStableBlock([]),
    tools: memoryOffTools,
  },
  {
    name: 'plan',
    models: ALLOWED_PLAN_MODELS,
    system: SYSTEM_PROMPT,
    tools: [EMIT_PLAN_TOOL as unknown as Anthropic.Tool],
  },
  {
    name: 'recap',
    models: ALLOWED_PLAN_MODELS,
    system: RECAP_SYSTEM_PROMPT,
    tools: [EMIT_RECAP_TOOL as unknown as Anthropic.Tool],
  },
]

async function count(model: string, surface?: Surface): Promise<number> {
  const res = await client.messages.countTokens({
    model,
    ...(surface ? { system: [{ type: 'text', text: surface.system }], tools: surface.tools } : {}),
    messages: [{ role: 'user', content: 'x' }],
  })
  return res.input_tokens
}

// Framing overhead (the 1-char message + scaffolding), counted once per model and subtracted.
const bare = new Map<string, number>()
const allModels = new Set(SURFACES.flatMap((s) => s.models))
for (const model of allModels) {
  const floor = CACHE_FLOOR_TOKENS[model]
  if (floor === undefined) {
    // A new allowlist entry must get a floor row above before this tool can vouch for it.
    console.error(`no cache floor known for allowlisted model "${model}" — add it to this script`)
    Deno.exit(2)
  }
  bare.set(model, await count(model))
}

console.log('cached-prefix tokens vs the minimum cacheable prompt length, per surface × model')
console.log('(a prefix BELOW its floor means cache_control is a silent no-op for that model)\n')
const pad = (s: string, n: number) => s.padEnd(n)
console.log(
  `${pad('surface', 20)}${pad('model', 20)}${pad('prefix tok', 12)}${pad('floor', 8)}verdict`,
)
for (const surface of SURFACES) {
  for (const model of surface.models) {
    const total = await count(model, surface)
    const prefix = total - (bare.get(model) ?? 0)
    const floor = CACHE_FLOOR_TOKENS[model]
    const verdict =
      prefix >= floor ? `CLEARS (${(prefix / floor).toFixed(1)}× the floor)` : 'BELOW — no caching'
    console.log(
      `${pad(surface.name, 20)}${pad(model, 20)}${pad(String(prefix), 12)}${pad(String(floor), 8)}${verdict}`,
    )
  }
}
console.log(
  '\nnote: chat block 2 (tasks/plan/activity) is deliberately uncached and not counted here.',
)
