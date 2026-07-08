import { test, expect } from '../helpers/fixtures'
import { openChat } from '../helpers/ui'
import { detectEscapes, mockAiChat, mockAiStatus, sse } from '../mocks/ai'

// Golden paths: streaming chat with the model MOCKED via canned SSE bodies (zero Anthropic
// spend — ADR-0018). Covers (1) the plain streamed reply, and (2) the destructive-tool
// confirmation round-trip: the first response HALTS on tool-pending-confirmation, the user
// confirms, and the client re-POSTs the echoed history with the approved tool_use id
// (ADR-0017's client-held-history contract). A third POST (a follow-up message) then proves
// the held history the client resends PAIRS the confirmed tool_use with its tool_result —
// the server appends that user turn locally but never re-echoes it, so the client must
// mirror it or the follow-up request carries a dangling tool_use the real API rejects (400).

// The wire shape the client parses (see supabase/functions/_shared/sse.ts + use-ai-chat.ts).
interface ChatRequestBody {
  messages: { role: string; content: unknown }[]
  approvedToolUseIds: string[]
}

test('a streamed reply renders token-by-token into one assistant bubble', async ({ page }) => {
  const escapes = await detectEscapes(page)
  await mockAiStatus(page)
  const chatRoute = await mockAiChat(page, [
    sse(
      { type: 'text-delta', text: 'Sure' },
      { type: 'text-delta', text: ' — adding' },
      { type: 'text-delta', text: ' it now.' },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Sure — adding it now.' }],
      },
      { type: 'done', stop_reason: 'end_turn' },
    ),
  ])

  await openChat(page)
  const panel = page.getByRole('complementary', { name: 'Chat' })

  await panel.getByLabel('Message').fill('add a task to call mom')
  await panel.getByRole('button', { name: 'Send' }).click()

  // The user bubble, then the assistant bubble assembled from the concatenated deltas.
  await expect(panel.getByText('add a task to call mom')).toBeVisible()
  await expect(panel.getByText('Sure — adding it now.')).toBeVisible()

  expect(chatRoute.posts()).toBe(1)
  const body = chatRoute.bodies()[0] as ChatRequestBody
  expect(body.messages[0]).toEqual({ role: 'user', content: 'add a task to call mom' })
  expect(body.approvedToolUseIds).toEqual([])
  expect(escapes()).toEqual([])
})

test('a destructive tool pauses for confirmation; Confirm re-sends with the approved id and the next turn carries the tool_result', async ({
  page,
}) => {
  const TOOL_ID = 'toolu_e2e_confirm_1'
  const SUMMARY = 'Mark "Water the plants" done for today'
  const TASK_INPUT = { task_id: '00000000-0000-0000-0000-000000000001' }

  const escapes = await detectEscapes(page)
  await mockAiStatus(page)
  const chatRoute = await mockAiChat(page, [
    // POST 1: the model wants a destructive tool → the stream HALTS awaiting confirmation,
    // echoing the client-held history including the halted assistant turn.
    sse(
      { type: 'text-delta', text: 'I can mark that done.' },
      {
        type: 'tool-pending-confirmation',
        tool_use_id: TOOL_ID,
        name: 'complete_task',
        input: TASK_INPUT,
        summary: SUMMARY,
        messages: [
          { role: 'user', content: 'complete the plants task' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'I can mark that done.' },
              { type: 'tool_use', id: TOOL_ID, name: 'complete_task', input: TASK_INPUT },
            ],
          },
        ],
      },
      { type: 'done', stop_reason: 'awaiting-confirmation' },
    ),
    // POST 2 (after Confirm): the approved tool executes → result note + closing reply.
    sse(
      {
        type: 'tool-result',
        tool_use_id: TOOL_ID,
        name: 'complete_task',
        ok: true,
        summary: 'Marked "Water the plants" done for today.',
      },
      { type: 'text-delta', text: 'Done!' },
      { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Done!' }] },
      { type: 'done', stop_reason: 'end_turn' },
    ),
    // POST 3 (follow-up message): a plain reply — this request's BODY is the point (see the
    // history assertions below).
    sse(
      { type: 'text-delta', text: 'All set.' },
      { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'All set.' }] },
      { type: 'done', stop_reason: 'end_turn' },
    ),
  ])

  await openChat(page)
  const panel = page.getByRole('complementary', { name: 'Chat' })
  await panel.getByLabel('Message').fill('complete the plants task')
  await panel.getByRole('button', { name: 'Send' }).click()

  // The stream halts: confirmation UI shows the summary. Since PR #154 the input STAYS usable —
  // a typed reply answers the confirmation (send routes yes/no to confirm/deny; unit-tested in
  // use-ai-chat.test.tsx) — signalled by the placeholder switching to the yes/no prompt.
  await expect(panel.getByText(`${SUMMARY}?`)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expect(panel.getByLabel('Message')).toBeEnabled()
  await expect(panel.getByLabel('Message')).toHaveAttribute('placeholder', /yes or no/i)

  // Confirm → the client re-POSTs with the approved id; the tool-result note and the closing
  // assistant reply render; the placeholder reverting proves the pending state cleared.
  await panel.getByRole('button', { name: 'Confirm' }).click()
  await expect(panel.getByText('✓ Confirmed.')).toBeVisible()
  await expect(panel.getByText('✓ Marked "Water the plants" done for today.')).toBeVisible()
  await expect(panel.getByText('Done!')).toBeVisible()
  await expect(panel.getByLabel('Message')).toHaveAttribute('placeholder', 'Message…')

  // The first POST is unapproved; the second carries the approved id AND the echoed history
  // with the halted assistant turn (the client-held-history contract).
  const [first, second] = chatRoute.bodies() as [ChatRequestBody, ChatRequestBody]
  expect(first.approvedToolUseIds).toEqual([])
  expect(second.approvedToolUseIds).toEqual([TOOL_ID])
  expect(second.messages).toHaveLength(2)
  expect(second.messages[1].role).toBe('assistant')

  // POST 3: a follow-up turn. The server executed the confirmed tool and appended the
  // tool_result user turn to its LOCAL copy only — it is never re-echoed, so the client must
  // mirror it into the history it holds. Without that, this request would resend
  // [user, assistant(tool_use), assistant] — a dangling tool_use the real API rejects with a
  // 400, bricking the conversation until reload.
  await panel.getByLabel('Message').fill('thanks!')
  await panel.getByRole('button', { name: 'Send' }).click()
  await expect(panel.getByText('All set.')).toBeVisible()

  expect(chatRoute.posts()).toBe(3)
  const third = chatRoute.bodies()[2] as ChatRequestBody
  expect(third.messages.map((m) => m.role)).toEqual([
    'user', // complete the plants task
    'assistant', // the halted tool_use turn (echoed on the pause)
    'user', // the mirrored tool_result — the pairing under test
    'assistant', // the closing "Done!" reply
    'user', // thanks!
  ])
  expect(third.messages[2]).toEqual({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: TOOL_ID,
        content: 'Marked "Water the plants" done for today.',
        is_error: false,
      },
    ],
  })
  expect(escapes()).toEqual([])
})
