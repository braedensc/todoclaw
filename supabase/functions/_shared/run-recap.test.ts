// Deno tests for generateRecap's cosmetic signoff repair (repair, not reject — the #350
// philosophy): the signoff is a hard format rule the model occasionally drops, and a missing
// signoff must never cost the user the message. The 2026-08-22 paid eval run shipped a body
// ending on a bare 🐾.
// Run: deno test --no-check supabase/functions/_shared/run-recap.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import type Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import { generateRecap } from './run-recap.ts'
import type { RecapRequest } from './recap-prompt.ts'

const REQ: RecapRequest = {
  dayName: 'Saturday',
  name: null,
  done: [],
  open: [],
  activity: [],
  upcoming: [],
  habitsKept: [],
}

/** Minimal Anthropic stub that returns a fixed emit_recap tool call. */
function stubClient(body: string): Anthropic {
  return {
    messages: {
      create: () =>
        Promise.resolve({
          content: [{ type: 'tool_use', name: 'emit_recap', input: { body } }],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
    },
  } as unknown as Anthropic
}

Deno.test('generateRecap appends the signoff when the model drops it', async () => {
  const { body } = await generateRecap(
    stubClient("Tomorrow's a fresh leash — we'll figure it out together. 🐾"),
    REQ,
    'claude-sonnet-5',
  )
  assert(body.endsWith('— BabyClaw 🐾'))
  // Appended on its own paragraph, not glued to the prose.
  assert(body.includes('🐾\n\n— BabyClaw 🐾'))
})

Deno.test('generateRecap leaves an already-correct signoff untouched', async () => {
  const original = 'Quiet day — rest up.\n\n— BabyClaw 🐾'
  const { body } = await generateRecap(stubClient(original), REQ, 'claude-sonnet-5')
  assertEquals(body, original)
})
