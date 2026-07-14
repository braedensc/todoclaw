// Deno tests for chat-store — the PURE, correctness-critical transcript bookkeeping: rows→messages
// shaping, window boundary/size cut + merge (never orphan a tool_result), dangling-tool_use repair,
// deny-answers-every-sibling, and title derivation. These are the pieces the review named
// (empty-window-after-boundary-cut, resume-pairing-at-window-edge, trailing-tool_result-then-message,
// multi-destructive deny). Run: deno test --no-check supabase/functions/_shared/chat-store.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  rowsToMessages,
  mergeConsecutive,
  windowMessages,
  repairDangling,
  danglingToolUseIds,
  haltedToolUseIds,
  buildDenyResults,
  deriveTitle,
  type Msg,
} from './chat-store.ts'

// ---- tiny builders (structural — mirror the stored Anthropic content shape) --------------------
const userText = (t: string) => ({ role: 'user', content: t }) as Msg
const assistantText = (t: string) =>
  ({ role: 'assistant', content: [{ type: 'text', text: t }] }) as Msg
const toolUse = (id: string, name = 'delete_task', input: unknown = {}) =>
  ({ role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }) as Msg
const multiToolUse = (...ids: string[]) =>
  ({
    role: 'assistant',
    content: ids.map((id) => ({ type: 'tool_use', id, name: 'delete_task', input: {} })),
  }) as Msg
const toolResult = (id: string, content = 'ok') =>
  ({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }],
  }) as Msg

const blocks = (m: Msg) =>
  Array.isArray(m.content) ? (m.content as unknown as Record<string, unknown>[]) : []

// ---- rowsToMessages ----------------------------------------------------------------------------

Deno.test('rowsToMessages drops rows with a bad role or null content', () => {
  const msgs = rowsToMessages([
    { seq: 1, role: 'user', content: 'hi' },
    { seq: 2, role: 'tool', content: 'x' }, // Anthropic has no tool role → dropped
    { seq: 3, role: 'assistant', content: null }, // null content → dropped
    { seq: 4, role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  ])
  assertEquals(msgs.length, 2)
  assertEquals(msgs[0].content, 'hi')
  assertEquals(msgs[1].role, 'assistant')
})

// ---- windowMessages: boundary cut --------------------------------------------------------------

Deno.test('windowMessages drops a leading orphaned tool_result and its assistant turn', () => {
  // A window whose head is a tool_result answering a tool_use that aged out — must be cut so the
  // window starts on a clean user turn (else the API 400s on an orphaned tool_result).
  const win = windowMessages([toolResult('t1'), assistantText('a'), userText('next')])
  assertEquals(win.length, 1)
  assertEquals(win[0].content, 'next')
})

Deno.test('windowMessages returns [] when nothing survives the boundary cut', () => {
  // No clean user start anywhere → empty window (the system prompt still re-injects live state).
  const win = windowMessages([toolResult('t1'), assistantText('a')])
  assertEquals(win.length, 0)
})

Deno.test('windowMessages keeps a valid transcript whose first turn is a clean user turn', () => {
  const input = [
    userText('u'),
    toolUse('t1', 'create_task'),
    toolResult('t1'),
    assistantText('done'),
  ]
  const win = windowMessages(input)
  assertEquals(win.length, 4)
  assertEquals(win[0].role, 'user')
  assertEquals(win[0].content, 'u')
})

// ---- windowMessages: size cut ------------------------------------------------------------------

Deno.test('windowMessages drops oldest whole turns while over the char budget', () => {
  const big = 'x'.repeat(500)
  const win = windowMessages([userText(big), assistantText(big), userText('small final')], 600)
  assertEquals(win.length, 1)
  assertEquals(win[0].content, 'small final')
})

Deno.test('windowMessages never leaves an orphaned tool_result after a size drop', () => {
  const big = 'x'.repeat(400)
  const input = [
    userText('u1'),
    toolUse('t1', 'create_task', { note: big }),
    toolResult('t1', big),
    userText('u2'),
  ]
  const win = windowMessages(input, 300)
  // Dropping u1 exposes the assistant tool_use + its tool_result; the boundary re-clean removes both,
  // leaving only the trailing clean user turn — no dangling/orphaned block survives.
  assertEquals(win.length, 1)
  assertEquals(win[0].content, 'u2')
})

// ---- mergeConsecutive --------------------------------------------------------------------------

Deno.test(
  'mergeConsecutive folds a repair tool_result turn + the new message into one user turn',
  () => {
    // The exact repair-then-new-message shape: a tool_result user turn immediately followed by a text
    // user turn must merge into a single user turn holding [tool_result…, text].
    const merged = mergeConsecutive([toolResult('t1'), userText('new message')])
    assertEquals(merged.length, 1)
    assertEquals(merged[0].role, 'user')
    const bs = blocks(merged[0])
    assertEquals(bs.length, 2)
    assertEquals(bs[0].type, 'tool_result')
    assertEquals(bs[1].type, 'text')
    assertEquals(bs[1].text, 'new message')
  },
)

Deno.test('mergeConsecutive leaves an alternating transcript unchanged', () => {
  const input = [userText('u'), assistantText('a'), userText('u2')]
  const merged = mergeConsecutive(input)
  assertEquals(merged.length, 3)
})

// ---- repairDangling ----------------------------------------------------------------------------

Deno.test('repairDangling answers a trailing unanswered tool_use as interrupted', () => {
  const { messages, repair } = repairDangling([userText('do X'), toolUse('t1')])
  assert(repair !== null)
  assertEquals(messages.length, 3)
  const bs = blocks(messages[2])
  assertEquals(bs[0].type, 'tool_result')
  assertEquals(bs[0].tool_use_id, 't1')
  assertEquals(bs[0].is_error, true)
  assertStringIncludes(String(bs[0].content), 'interrupted')
})

Deno.test('repairDangling answers EVERY id in a multi-tool_use halted turn', () => {
  const { messages, repair } = repairDangling([userText('x'), multiToolUse('t1', 't2')])
  assert(repair !== null)
  const bs = blocks(messages[messages.length - 1])
  assertEquals(bs.map((b) => b.tool_use_id).sort(), ['t1', 't2'])
})

Deno.test('repairDangling is a no-op on a clean (non-dangling) transcript', () => {
  const { messages, repair } = repairDangling([userText('hi'), assistantText('hello')])
  assertEquals(repair, null)
  assertEquals(messages.length, 2)
})

Deno.test('danglingToolUseIds / haltedToolUseIds read the last halted assistant turn', () => {
  assertEquals(haltedToolUseIds([userText('x'), multiToolUse('t1', 't2')]), ['t1', 't2'])
  assertEquals(danglingToolUseIds([userText('x'), assistantText('done')]), null)
  assertEquals(haltedToolUseIds([userText('x'), toolResult('t1')]), []) // last is a user turn
})

// ---- buildDenyResults (multi-destructive deny) -------------------------------------------------

Deno.test(
  'buildDenyResults declines the target, marks siblings not-executed, appends the note',
  () => {
    const deny = buildDenyResults(['t1', 't2'], 't1', 'make it Friday instead')
    const bs = blocks(deny)
    assertEquals(deny.role, 'user')
    assertEquals(bs.length, 3)
    assertEquals(bs[0].tool_use_id, 't1')
    assertStringIncludes(String(bs[0].content), 'declined')
    assertEquals(bs[1].tool_use_id, 't2')
    assertStringIncludes(String(bs[1].content), 'sibling')
    assertEquals(bs[2].type, 'text')
    assertStringIncludes(String(bs[2].text), 'Friday')
    // Every tool_result carries is_error so the model treats the turn as not-done.
    assert(bs.slice(0, 2).every((b) => b.is_error === true))
  },
)

Deno.test('buildDenyResults with no note omits the trailing text block', () => {
  const deny = buildDenyResults(['t1'], 't1')
  assertEquals(blocks(deny).length, 1)
})

// ---- deriveTitle -------------------------------------------------------------------------------

Deno.test('deriveTitle strips markers, collapses whitespace, and slices to 80 chars', () => {
  assertEquals(deriveTitle('  Plan my day [[status: on it]]  '), 'Plan my day')
  assertEquals(deriveTitle('multi\n line\ttext'), 'multi line text')
  assertEquals(deriveTitle('a'.repeat(200)).length, 80)
})
