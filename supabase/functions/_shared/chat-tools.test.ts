// Tests for the chat tools' pure surface: which tools exist, which are destructive, input
// validation, and the confirmation summary. The DB-mutating executors are exercised by the
// function integration test (curl) — here we prove the validation gate + classification.
// Run: deno test --no-check supabase/functions/_shared/chat-tools.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  TOOL_DEFS,
  DESTRUCTIVE,
  destructiveSummary,
  executeTool,
  type ToolContext,
} from './chat-tools.ts'

Deno.test('exactly complete_task + delete_task are destructive', () => {
  assertEquals([...DESTRUCTIVE].sort(), ['complete_task', 'delete_task'])
})

Deno.test('all destructive tools are real tools', () => {
  const names = new Set(TOOL_DEFS.map((t) => t.name))
  for (const d of DESTRUCTIVE) assert(names.has(d))
})

Deno.test('confirmation summary prefers the task text, falls back to the id', () => {
  assertEquals(
    destructiveSummary('delete_task', { task_id: 'abc' }, 'Call dentist'),
    'Move "Call dentist" to the trash',
  )
  assert(destructiveSummary('complete_task', { task_id: 'abc' }).includes('abc'))
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
