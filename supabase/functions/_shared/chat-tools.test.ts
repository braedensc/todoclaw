// Tests for the Anthropic adapter over the capability registry: which tools are advertised, the
// destructive classification, the validation gate, and the confirmation summary. The DB-mutating
// executors + per-capability behavior are covered in ./capabilities/registry.test.ts.
// Run: deno test --no-check supabase/functions/_shared/chat-tools.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  TOOL_DEFS,
  DESTRUCTIVE,
  destructiveSummary,
  executeTool,
  type ToolContext,
} from './chat-tools.ts'

Deno.test(
  'complete_task, delete_task, delete_habit, delete_completion are the destructive tools',
  () => {
    assertEquals([...DESTRUCTIVE].sort(), [
      'complete_task',
      'delete_completion',
      'delete_habit',
      'delete_task',
    ])
  },
)

Deno.test('all destructive tools are real, advertised tools', () => {
  const names = new Set(TOOL_DEFS.map((t) => t.name))
  for (const d of DESTRUCTIVE) assert(names.has(d))
})

Deno.test('every advertised tool has an object input_schema and a description', () => {
  for (const t of TOOL_DEFS) {
    assertEquals((t.input_schema as { type?: string }).type, 'object')
    assert(typeof t.description === 'string' && t.description.length > 0)
  }
})

Deno.test('confirmation summary prefers the label, falls back to the id (tasks + habits)', () => {
  assertEquals(
    destructiveSummary('delete_task', { task_id: 'abc' }, 'Call dentist'),
    'Move "Call dentist" to the trash',
  )
  assert(destructiveSummary('complete_task', { task_id: 'abc' }).includes('abc'))
  assertEquals(
    destructiveSummary('delete_habit', { habit_id: 'h1' }, 'Meditate'),
    'Delete the habit "Meditate"',
  )
  // delete_completion has no task/habit label to resolve — a plain, id-free line.
  assertEquals(
    destructiveSummary('delete_completion', { completion_id: 'h9' }),
    'Remove a completion from your Done log',
  )
})

Deno.test('invalid input is rejected before any DB call (is_error)', async () => {
  const ctx = {} as ToolContext // never reached — validation fails first
  const noText = await executeTool('create_task', { text: '' }, ctx)
  assert(noText.is_error)
  const badId = await executeTool('complete_task', { task_id: 'not-a-uuid' }, ctx)
  assert(badId.is_error)
  const unknown = await executeTool('nope', {}, ctx)
  assert(unknown.is_error)
})
