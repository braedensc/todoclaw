import { test, expect } from '../helpers/fixtures'
import { detectEscapes, mockAiChat, mockAiStatus, sse } from '../mocks/ai'

// Golden paths: streaming chat with the model MOCKED via canned SSE bodies (zero Anthropic
// spend — ADR-0018). Covers (1) the plain streamed reply, and (2) the destructive-tool
// confirmation round-trip: the first response HALTS on tool-pending-confirmation, the user
// confirms, and the client re-POSTs the echoed history with the approved tool_use id
// (ADR-0017's client-held-history contract) — exactly two requests.

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

  await page.getByRole('button', { name: 'Chat' }).click()
  const panel = page.getByRole('complementary', { name: 'Chat' })
  await expect(panel).toBeVisible()

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

test('a destructive tool pauses for confirmation; Confirm re-sends with the approved id', async ({
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
  ])

  await page.getByRole('button', { name: 'Chat' }).click()
  const panel = page.getByRole('complementary', { name: 'Chat' })
  await panel.getByLabel('Message').fill('complete the plants task')
  await panel.getByRole('button', { name: 'Send' }).click()

  // The stream halts: confirmation UI shows the summary, and the input is locked while pending.
  await expect(panel.getByText(`${SUMMARY}?`)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expect(panel.getByLabel('Message')).toBeDisabled()

  // Confirm → the client re-POSTs with the approved id; the tool-result note and the closing
  // assistant reply render; the input unlocks.
  await panel.getByRole('button', { name: 'Confirm' }).click()
  await expect(panel.getByText('✓ Confirmed.')).toBeVisible()
  await expect(panel.getByText('✓ Marked "Water the plants" done for today.')).toBeVisible()
  await expect(panel.getByText('Done!')).toBeVisible()
  await expect(panel.getByLabel('Message')).toBeEnabled()

  // Exactly two POSTs: the first unapproved, the second carrying the approved id AND the echoed
  // history with the halted assistant turn (the client-held-history contract).
  expect(chatRoute.posts()).toBe(2)
  const [first, second] = chatRoute.bodies() as [ChatRequestBody, ChatRequestBody]
  expect(first.approvedToolUseIds).toEqual([])
  expect(second.approvedToolUseIds).toEqual([TOOL_ID])
  expect(second.messages).toHaveLength(2)
  expect(second.messages[1].role).toBe('assistant')
  expect(escapes()).toEqual([])
})
