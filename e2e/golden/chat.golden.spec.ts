import { test, expect } from '../helpers/fixtures'
import { openChat } from '../helpers/ui'
import { detectEscapes, mockAiChat, mockAiStatus, sse } from '../mocks/ai'

// Golden paths: streaming chat with the model MOCKED via canned SSE bodies (zero Anthropic
// spend — ADR-0018). Covers (1) the plain streamed reply, and (2) the destructive-tool
// confirmation round-trip: the first response HALTS on tool-pending-confirmation, the user
// confirms, and the client sends a confirm ACTION for that tool_use id.
//
// The transcript is SERVER-AUTHORITATIVE (persistent-chats ADR): the client holds no history and
// never resends it. Each turn is a single new `message` OR a confirm/deny `action`, always scoped
// to a `session_id` (null = create a new session; the server answers with a `session` event). The
// dangling-tool_use invariant the old client-held-history contract policed here now lives on the
// server, which answers every tool_use in the halted turn against its OWN recorded `pending`.
//
// What stays worth proving from the client: the session id the server hands back is ADOPTED, so
// the confirm and every later turn ride the SAME conversation. Miss that and each turn opens a new
// session — the chat silently fragments and confirmations resolve against nothing.

// The wire shape the client SENDS (see supabase/functions/ai-chat/index.ts BodySchema).
type ChatRequestBody =
  | { session_id: string | null; message: string; seed?: string }
  | {
      session_id: string
      action: { type: 'confirm' | 'deny'; tool_use_id: string; note?: string }
    }

// A server-issued session id must be a uuid (BodySchema) — the client echoes it back verbatim.
const SESSION_ID = '3f1c9a2e-5b74-4c8d-9e10-6a2b7d4f8c31'

test('a streamed reply renders token-by-token into one assistant bubble', async ({ page }) => {
  const escapes = await detectEscapes(page)
  await mockAiStatus(page)
  const chatRoute = await mockAiChat(page, [
    sse(
      // The server opens every response by naming the session (here: freshly created).
      { type: 'session', session_id: SESSION_ID },
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

  // One new turn: the bare user message into a not-yet-created session. No history, no approvals.
  expect(chatRoute.posts()).toBe(1)
  const body = chatRoute.bodies()[0] as ChatRequestBody
  expect(body).toEqual({ session_id: null, message: 'add a task to call mom' })
  expect(escapes()).toEqual([])
})

test('a destructive tool pauses for confirmation; confirming sends an action for that id and later turns stay in the same session', async ({
  page,
}) => {
  const TOOL_ID = 'toolu_e2e_confirm_1'
  const SUMMARY = 'Mark "Water the plants" done for today'

  const escapes = await detectEscapes(page)
  await mockAiStatus(page)
  const chatRoute = await mockAiChat(page, [
    // POST 1: the model wants a destructive tool → the stream HALTS awaiting confirmation. The
    // server records the pending tool itself; the wire carries only what the UI must show.
    sse(
      { type: 'session', session_id: SESSION_ID },
      { type: 'text-delta', text: 'I can mark that done.' },
      {
        type: 'tool-pending-confirmation',
        tool_use_id: TOOL_ID,
        name: 'complete_task',
        summary: SUMMARY,
      },
      { type: 'done', stop_reason: 'awaiting-confirmation' },
    ),
    // POST 2 (after confirming): the approved tool executes → result note + closing reply. No
    // `display` field → the client shows `summary`, mirroring a tool with no display override.
    sse(
      { type: 'session', session_id: SESSION_ID },
      {
        type: 'tool-result',
        tool_use_id: TOOL_ID,
        name: 'complete_task',
        ok: true,
        summary: 'Marked "Water the plants" done for today.',
        mutated: ['tasks', 'daily_state'],
      },
      { type: 'text-delta', text: 'Done!' },
      { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Done!' }] },
      { type: 'done', stop_reason: 'end_turn' },
    ),
    // POST 3 (follow-up message): a plain reply — this request's BODY is the point (see the
    // session-adoption assertion below).
    sse(
      { type: 'session', session_id: SESSION_ID },
      { type: 'text-delta', text: 'All set.' },
      { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'All set.' }] },
      { type: 'done', stop_reason: 'end_turn' },
    ),
  ])

  await openChat(page)
  const panel = page.getByRole('complementary', { name: 'Chat' })
  await panel.getByLabel('Message').fill('complete the plants task')
  await panel.getByRole('button', { name: 'Send' }).click()

  // The stream halts: confirmation UI shows the summary. The composer stays ENABLED with a yes/no
  // placeholder — a typed reply answers the confirmation (PR #154); the buttons are the
  // one-click path.
  await expect(panel.getByText(`${SUMMARY}?`)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Not now' })).toBeVisible()
  await expect(panel.getByLabel('Message')).toHaveAttribute(
    'placeholder',
    'Yes or no — or say what to do instead…',
  )

  // Confirm → the tool-result note and the closing assistant reply render; the pending state
  // clears (placeholder returns to the default). The ✓/✕ on a receipt is aria-hidden decoration
  // in its own span, so match the receipt's words, not the glyph.
  await panel.getByRole('button', { name: 'Yes, do it' }).click()
  await expect(panel.getByText('Confirmed.')).toBeVisible()
  await expect(panel.getByText('Marked "Water the plants" done for today.')).toBeVisible()
  await expect(panel.getByText('Done!')).toBeVisible()
  await expect(panel.getByLabel('Message')).toHaveAttribute(
    'placeholder',
    'Tell BabyClaw what you need…',
  )

  // POST 1 opened a new session with the bare message; POST 2 is the confirm ACTION for that
  // tool_use id, addressed to the session the server named — proving the `session` event was
  // adopted. A client that ignored it would send session_id: null and resolve nothing.
  const [first, second] = chatRoute.bodies() as [ChatRequestBody, ChatRequestBody]
  expect(first).toEqual({ session_id: null, message: 'complete the plants task' })
  expect(second).toEqual({
    session_id: SESSION_ID,
    action: { type: 'confirm', tool_use_id: TOOL_ID },
  })

  // POST 3: a follow-up turn carries only the new message — the transcript is server-side, so the
  // client resends no history. It must still ride the SAME session_id; otherwise every turn forks
  // a new conversation and the thread silently fragments.
  await panel.getByLabel('Message').fill('thanks!')
  await panel.getByRole('button', { name: 'Send' }).click()
  await expect(panel.getByText('All set.')).toBeVisible()

  expect(chatRoute.posts()).toBe(3)
  expect(chatRoute.bodies()[2]).toEqual({ session_id: SESSION_ID, message: 'thanks!' })
  expect(escapes()).toEqual([])
})
