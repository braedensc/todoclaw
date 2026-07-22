// harness_test.ts — self-tests for the harness's own moving parts (no network, no DB, no key):
// the SSE accumulator, turn folding (incl. the real splitReply import), check combinators, and
// baseline comparison. Run with `deno task test` from evals/ — NOT part of repo CI.

import { assert, assertEquals } from 'jsr:@std/assert@1'
import { foldTurn, SseAccumulator } from './chat-driver.ts'
import {
  confirmRequested,
  noVisibleLeak,
  statusLineAlways,
  toolCalled,
  toolNotExecuted,
} from './checks.ts'
import { detPass, overallPass } from './report.ts'
import type { ChatTrace, DbSnapshot, ScenarioResult } from './types.ts'

// checks may return one result or a list; every combinator used here returns one
function one(res: { pass: boolean } | { pass: boolean }[]): { pass: boolean } {
  if (Array.isArray(res)) throw new Error('expected a single CheckResult')
  return res
}

const emptyDb: DbSnapshot = {
  ids: { tasks: {}, habits: {} },
  tasks: [],
  reminders: [],
  memories: [],
  dailyDone: {},
  dailyHabitDone: {},
  historyTexts: [],
}

function ev(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

Deno.test('SseAccumulator parses framed events across chunk boundaries', () => {
  const acc = new SseAccumulator()
  const whole = ev({ type: 'session', session_id: 's1' }) + ev({ type: 'text-delta', text: 'hi' })
  acc.push(whole.slice(0, 25))
  acc.push(whole.slice(25))
  assertEquals(acc.events.length, 2)
  assertEquals(acc.events[0].type, 'session')
  assertEquals(acc.events[1].text, 'hi')
})

Deno.test('foldTurn extracts text, status line, tool uses, and pending state', () => {
  const events = [
    { type: 'session', session_id: 's1' },
    { type: 'text-delta', text: 'Paused it for you 🐾\n' },
    { type: 'text-delta', text: '[[status: Paused until Friday]]' },
    {
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'irrelevant' },
        {
          type: 'tool_use',
          id: 't1',
          name: 'pause_task',
          input: { task_id: 'x', until: '2026-09-20' },
        },
      ],
    },
    {
      type: 'tool-result',
      tool_use_id: 't1',
      name: 'pause_task',
      ok: true,
      summary: 'Paused "x" until 2026-09-20 (id abc)',
      display: 'Paused until Sep 20',
    },
    { type: 'done', stop_reason: 'end_turn' },
  ]
  const turn = foldTurn({ say: 'pause it' }, events)
  assertEquals(turn.status, 'Paused until Friday')
  assert(!turn.needsInput)
  assertEquals(turn.toolUses[0].name, 'pause_task')
  assertEquals(turn.toolResults[0].ok, true)
  assertEquals(turn.stopReason, 'end_turn')
  assertEquals(turn.pending, null)
})

Deno.test('foldTurn: waiting status marker sets needsInput', () => {
  const turn = foldTurn({ say: 'hm' }, [
    { type: 'text-delta', text: 'Which task did you mean?\n[[status: ? Need the task name]]' },
    { type: 'done', stop_reason: 'end_turn' },
  ])
  assertEquals(turn.status, 'Need the task name')
  assert(turn.needsInput)
})

function traceWith(turns: ReturnType<typeof foldTurn>[]): ChatTrace {
  return { sessionId: 's1', turns }
}

Deno.test('check combinators: toolCalled / toolNotExecuted / confirmRequested', () => {
  const halted = foldTurn({ say: 'mark taxes done' }, [
    { type: 'text-delta', text: 'One sec.\n[[status: Confirming]]' },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't9', name: 'complete_task', input: { task_id: 'z' } }],
    },
    {
      type: 'tool-pending-confirmation',
      tool_use_id: 't9',
      name: 'complete_task',
      summary: 'Mark "taxes" done',
    },
    { type: 'done', stop_reason: 'awaiting-confirmation' },
  ])
  const t = traceWith([halted])
  assert(one(toolCalled('complete_task')(t, emptyDb)).pass)
  assert(one(confirmRequested('complete_task')(t, emptyDb)).pass)
  assert(one(toolNotExecuted('complete_task')(t, emptyDb)).pass) // pending ≠ executed
  assert(one(statusLineAlways()(t, emptyDb)).pass)
})

Deno.test('noVisibleLeak: hidden displays are ignored, uuids in shown text are caught', () => {
  const clean = foldTurn({ say: 'list' }, [
    { type: 'text-delta', text: 'Here you go.\n[[status: Listed]]' },
    {
      type: 'tool-result',
      tool_use_id: 'a',
      name: 'list_tasks',
      ok: true,
      summary: 'id 123e4567-e89b-42d3-a456-426614174000',
      display: null,
    },
    { type: 'done', stop_reason: 'end_turn' },
  ])
  assert(one(noVisibleLeak()(traceWith([clean]), emptyDb)).pass)

  const leaky = foldTurn({ say: 'x' }, [
    {
      type: 'text-delta',
      text: 'Task 123e4567-e89b-42d3-a456-426614174000 updated\n[[status: Done]]',
    },
    { type: 'done', stop_reason: 'end_turn' },
  ])
  assert(!one(noVisibleLeak()(traceWith([leaky]), emptyDb)).pass)
})

Deno.test(
  'report pass logic: judge fail beats deterministic pass; expectFail is not special-cased here',
  () => {
    const res: ScenarioResult = {
      id: 'x',
      kind: 'chat',
      tags: [],
      title: 'x',
      deterministic: [{ name: 'a', pass: true }],
      judge: {
        verdict: 'fail',
        scores: { correctness: 1, faithfulness: 3, tone: 3, brevity: 3 },
        reasoning: 'r',
      },
      durationMs: 1,
      usage: { input: 0, output: 0 },
    }
    assert(detPass(res))
    assert(!overallPass(res))
  },
)
