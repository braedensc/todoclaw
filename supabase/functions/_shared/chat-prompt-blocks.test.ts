// Tests for the buildSystemBlocks split (phase-0 PR 3, prompt caching). chat-prompt.test.ts pins
// the JOINED string (buildSystem) and passes UNMODIFIED — that is the byte-equivalence proof for
// the split; this file pins only the block STRUCTURE the Anthropic request depends on.
// Run: deno test --no-check supabase/functions/_shared/chat-prompt-blocks.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  SYSTEM_PREFIX,
  buildSystem,
  buildSystemBlocks,
  DEFAULT_ASSISTANT_CONFIG,
  type ChatContext,
} from './chat-prompt.ts'

function baseContext(over: Partial<ChatContext> = {}): ChatContext {
  return {
    today: 'Saturday, July 4, 2026',
    nowTime: '11:00 AM',
    timeZone: 'America/New_York',
    scheduleSummary: null,
    reminderDefault: 60,
    tasks: [],
    habits: [],
    plan: null,
    assistant: DEFAULT_ASSISTANT_CONFIG,
    memories: [],
    activity: [],
    ...over,
  }
}

Deno.test('buildSystemBlocks: exactly two blocks, cache_control on block 1 ONLY', () => {
  const blocks = buildSystemBlocks(baseContext())
  assertEquals(blocks.length, 2)
  assertEquals(blocks[0].type, 'text')
  assertEquals(blocks[1].type, 'text')
  // Block 1 carries the ephemeral breakpoint (5-min TTL — caches tools + stable prefix together).
  assertEquals(blocks[0].cache_control, { type: 'ephemeral' })
  // Block 2 is the volatile context and must stay UNCACHED — a breakpoint here would pay the
  // 1.25× write surcharge on minute-granular bytes that never repeat.
  assertEquals(blocks[1].cache_control, undefined)
})

Deno.test('buildSystemBlocks: stable prefix in block 1, volatile context in block 2', () => {
  const ctx = baseContext({
    memories: [{ id: 'm1', savedOn: '2026-07-01', content: 'works out most mornings' }],
  })
  const [stable, volatile] = buildSystemBlocks(ctx)
  // Stable half: persona/rules + per-user blocks that only change when the user edits them.
  assertStringIncludes(stable.text, SYSTEM_PREFIX)
  assertStringIncludes(stable.text, '=== SAVED MEMORY')
  assert(!stable.text.includes('=== TODAY ==='))
  // Volatile half: the minute-granular context — never in the cached block.
  assertStringIncludes(volatile.text, '=== TODAY ===')
  assertStringIncludes(volatile.text, '11:00 AM')
  assert(!volatile.text.includes('You are BabyClaw'))
})

Deno.test('buildSystem === join of buildSystemBlocks (the equivalence contract)', () => {
  // buildSystem is pinned by ~40 assertions in chat-prompt.test.ts; this ties the block split to
  // that oracle: the two blocks joined at the '\n\n' seam ARE the single-string prompt.
  const ctx = baseContext({
    memories: [{ id: 'm1', savedOn: '2026-07-01', content: 'works out most mornings' }],
  })
  const blocks = buildSystemBlocks(ctx)
  assertEquals(blocks.map((b) => b.text).join('\n\n'), buildSystem(ctx))
})
