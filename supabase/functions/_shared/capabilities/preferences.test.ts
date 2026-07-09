// Tests for set_assistant_preference, exercised through the Anthropic adapter's executeTool
// (validate → run). A tiny fake user_schedule client seeds the current config on select and
// captures the config written on update, so we prove: the validation gate (enum reject), the
// server-side 500-char cap + trim, the no-op rejection, that OTHER config keys survive the merge,
// and partial updates (tone-only / note-only / clear).
//
// NOTE: the load-bearing guard — "never persist a preference derived from stored task/habit/step
// text" — is a PROMPT-level instruction (chat-prompt.ts SYSTEM_PREFIX) and thus model behavior, not
// unit-testable here: this capability only writes what it is handed. The injection defense lives in
// the prompt wording plus the fact that SYSTEM_PREFIX rules always come first and always win.
//
// Run: deno test --no-check supabase/functions/_shared/capabilities/preferences.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { executeTool } from '../chat-tools.ts'
import type { ToolContext } from '../chat-tools.ts'

interface Result {
  data?: unknown
  error?: unknown
}

// A fake client for the single user_schedule row: select() returns the seeded row; update()
// captures the written `config`. `from()` returns a fresh chainable each call, so the read and the
// write in one execute() are independent — exactly like the real client.
function makeCtx(seedConfig: Record<string, unknown> | null, hasRow = true) {
  let written: Record<string, unknown> | undefined
  const client = {
    from(_table: string) {
      let mode: 'select' | 'update' = 'select'
      let patch: Record<string, unknown> | undefined
      const q = {
        select() {
          return q
        },
        update(p: Record<string, unknown>) {
          mode = 'update'
          patch = p
          return q
        },
        eq() {
          return q
        },
        is() {
          return q
        },
        maybeSingle(): Promise<Result> {
          if (mode === 'update') {
            written = (patch as { config: Record<string, unknown> }).config
            return Promise.resolve({ data: { user_id: 'u1' }, error: null })
          }
          return Promise.resolve({
            data: hasRow ? { user_id: 'u1', config: seedConfig } : null,
            error: null,
          })
        },
      }
      return q
    },
    rpc() {
      return Promise.resolve({ data: null, error: null })
    },
  } as unknown as ToolContext['client']
  const ctx: ToolContext = {
    client,
    timeZone: 'America/New_York',
    now: new Date('2026-07-09T12:00:00Z'),
  }
  return { ctx, getWritten: () => written }
}

const assistantOf = (config: Record<string, unknown> | undefined) =>
  (config?.assistant ?? {}) as Record<string, unknown>

// ---- validation gate -------------------------------------------------------------------------
Deno.test('rejects an invalid tone at the validation gate (before any DB call)', async () => {
  const { ctx, getWritten } = makeCtx({})
  const res = await executeTool('set_assistant_preference', { tone: 'spicy' }, ctx)
  assert(res.is_error)
  assertEquals(getWritten(), undefined) // never reached the write
})

Deno.test('rejects an invalid verbosity at the validation gate', async () => {
  const { ctx } = makeCtx({})
  const res = await executeTool('set_assistant_preference', { verbosity: 'chatty' }, ctx)
  assert(res.is_error)
})

Deno.test('rejects an unknown field (schema is .strict())', async () => {
  const { ctx } = makeCtx({})
  const res = await executeTool('set_assistant_preference', { color: 'blue' }, ctx)
  assert(res.is_error)
})

// ---- no-op rejection -------------------------------------------------------------------------
Deno.test('rejects a no-op call (nothing provided)', async () => {
  const { ctx, getWritten } = makeCtx({ assistant: { tone: 'warm' } })
  const res = await executeTool('set_assistant_preference', {}, ctx)
  assert(res.is_error)
  assertEquals(getWritten(), undefined) // nothing written for a no-op
})

// ---- server-side cap + trim ------------------------------------------------------------------
Deno.test('hard-caps a long note at 500 chars and trims surrounding whitespace', async () => {
  const { ctx, getWritten } = makeCtx({})
  const long = '  ' + 'a'.repeat(600) + '  '
  const res = await executeTool('set_assistant_preference', { note: long }, ctx)
  assert(!res.is_error)
  const note = assistantOf(getWritten()).customInstructions as string
  assertEquals(note.length, 500)
  assertEquals(note, 'a'.repeat(500))
})

// ---- scope: every OTHER config key survives the merge ----------------------------------------
Deno.test('preserves all other config keys when saving a preference', async () => {
  const seed = {
    location: 'Brooklyn',
    commitments: [{ label: 'Gym', when: 'Tue/Thu 6pm' }],
    weekday: { wakeTime: '7:00' },
    weekend: { saturday: { freeTimeEstimateHours: 5 } },
    planNotes: 'no meetings before 10',
    notifications: { enabled: true },
    assistant: { tone: 'warm', verbosity: 'brief' },
  }
  const { ctx, getWritten } = makeCtx(seed)
  const res = await executeTool('set_assistant_preference', { tone: 'playful' }, ctx)
  assert(!res.is_error)
  const w = getWritten()!
  // Untouched siblings survive verbatim...
  assertEquals(w.location, 'Brooklyn')
  assertEquals(w.commitments, seed.commitments)
  assertEquals(w.weekday, seed.weekday)
  assertEquals(w.weekend, seed.weekend)
  assertEquals(w.planNotes, seed.planNotes)
  assertEquals(w.notifications, seed.notifications)
  // ...and only the requested assistant sub-field changed.
  const a = assistantOf(w)
  assertEquals(a.tone, 'playful')
  assertEquals(a.verbosity, 'brief')
})

// ---- partial updates -------------------------------------------------------------------------
Deno.test('partial update: {tone} changes only tone', async () => {
  const { ctx, getWritten } = makeCtx({
    assistant: { tone: 'warm', verbosity: 'normal', customInstructions: 'keep it snappy' },
  })
  const res = await executeTool('set_assistant_preference', { tone: 'neutral' }, ctx)
  assert(!res.is_error)
  const a = assistantOf(getWritten())
  assertEquals(a.tone, 'neutral')
  assertEquals(a.verbosity, 'normal')
  assertEquals(a.customInstructions, 'keep it snappy')
})

Deno.test('partial update: {note} changes only customInstructions', async () => {
  const { ctx, getWritten } = makeCtx({ assistant: { tone: 'playful', verbosity: 'brief' } })
  const res = await executeTool('set_assistant_preference', { note: 'call me Cap' }, ctx)
  assert(!res.is_error)
  const a = assistantOf(getWritten())
  assertEquals(a.customInstructions, 'call me Cap')
  assertEquals(a.tone, 'playful')
  assertEquals(a.verbosity, 'brief')
})

Deno.test('empty note clears customInstructions but leaves tone/verbosity', async () => {
  const { ctx, getWritten } = makeCtx({
    assistant: { tone: 'warm', verbosity: 'brief', customInstructions: 'old note' },
  })
  const res = await executeTool('set_assistant_preference', { note: '' }, ctx)
  assert(!res.is_error)
  const a = assistantOf(getWritten())
  assert(!('customInstructions' in a)) // cleared, not stored as ''
  assertEquals(a.tone, 'warm')
  assertEquals(a.verbosity, 'brief')
})

Deno.test('null note also clears customInstructions', async () => {
  const { ctx, getWritten } = makeCtx({ assistant: { customInstructions: 'old note' } })
  const res = await executeTool('set_assistant_preference', { note: null }, ctx)
  assert(!res.is_error)
  assert(!('customInstructions' in assistantOf(getWritten())))
})

// ---- user-facing display vs model-facing content ---------------------------------------------
Deno.test('shows the user a transparent, id-free saved line (not the model content)', async () => {
  const { ctx } = makeCtx({})
  const res = await executeTool('set_assistant_preference', { tone: 'playful' }, ctx)
  assert(!res.is_error)
  assert(typeof res.display === 'string' && res.display.length > 0)
  assert(res.display!.includes('remember'))
  // The board doesn't change — no live-refresh domain is reported.
  assertEquals(res.mutated, undefined)
})

// ---- graceful degradation --------------------------------------------------------------------
Deno.test('degrades gracefully when the user has no schedule row yet', async () => {
  const { ctx, getWritten } = makeCtx(null, /* hasRow */ false)
  const res = await executeTool('set_assistant_preference', { tone: 'playful' }, ctx)
  assert(res.is_error)
  assertEquals(getWritten(), undefined)
})
