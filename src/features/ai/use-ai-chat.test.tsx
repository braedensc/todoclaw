import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock the Supabase client (session token only; the function is mocked via fetch).
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}))

import { useAiChat } from './use-ai-chat'

// useAiChat reads a QueryClient (for live-refresh invalidation), so every render needs a provider.
// A fresh client per test keeps invalidation-spy assertions isolated.
let queryClient: QueryClient
let invalidateSpy: ReturnType<typeof vi.fn>
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

// Build a fetch Response whose body streams the given SSE events.
function sseResponse(events: object[], status = 200) {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
      c.close()
    },
  })
  return { ok: status < 400, status, body } as unknown as Response
}

const fetchMock = vi.fn()

const sentBody = (call: number) =>
  JSON.parse(fetchMock.mock.calls[call]![1].body) as {
    messages: { role: string; content: unknown }[]
    approvedToolUseIds: string[]
  }

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  invalidateSpy = vi.fn()
  queryClient.invalidateQueries = invalidateSpy as unknown as typeof queryClient.invalidateQueries
})
afterEach(() => vi.unstubAllGlobals())

describe('useAiChat', () => {
  it('streams text deltas into an assistant bubble and finishes on end_turn', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { type: 'text-delta', text: 'Added ' },
        { type: 'text-delta', text: 'it.' },
        { type: 'message', role: 'assistant', content: [] },
        { type: 'done', stop_reason: 'end_turn' },
      ]),
    )

    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('add a task'))

    await waitFor(() => expect(result.current.busy).toBe(false))
    const roles = result.current.items.map((i) => i.role)
    expect(roles).toEqual(['user', 'assistant'])
    expect(result.current.items[0]!.text).toBe('add a task')
    expect(result.current.items[1]!.text).toBe('Added it.')
  })

  it('pauses on a destructive tool, runs it after confirm, and pairs the tool_result into the held history', async () => {
    fetchMock
      .mockResolvedValueOnce(
        sseResponse([
          { type: 'text-delta', text: "I'll delete it." },
          {
            type: 'tool-pending-confirmation',
            tool_use_id: 'toolu_9',
            name: 'delete_task',
            input: { task_id: 't1' },
            summary: 'Move "Call dentist" to the trash',
            // The server's echo always ends with the halted assistant tool_use turn.
            messages: [
              { role: 'user', content: 'remove dentist' },
              {
                role: 'assistant',
                content: [
                  { type: 'text', text: "I'll delete it." },
                  {
                    type: 'tool_use',
                    id: 'toolu_9',
                    name: 'delete_task',
                    input: { task_id: 't1' },
                  },
                ],
              },
            ],
          },
          { type: 'done', stop_reason: 'awaiting-confirmation' },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: 'tool-result',
            tool_use_id: 'toolu_9',
            name: 'delete_task',
            ok: true,
            summary: 'Moved to the trash "Call dentist".',
          },
          { type: 'text-delta', text: 'Done.' },
          { type: 'message', role: 'assistant', content: [] },
          { type: 'done', stop_reason: 'end_turn' },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: 'message', role: 'assistant', content: [] },
          { type: 'done', stop_reason: 'end_turn' },
        ]),
      )

    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('remove dentist'))

    await waitFor(() =>
      expect(result.current.pending?.summary).toBe('Move "Call dentist" to the trash'),
    )

    act(() => result.current.confirm())
    await waitFor(() => expect(result.current.pending).toBeNull())
    await waitFor(() => expect(result.current.busy).toBe(false))

    // Second request carried the approved id.
    expect(sentBody(1).approvedToolUseIds).toEqual(['toolu_9'])
    // The executed tool note + the follow-up text are shown.
    expect(result.current.items.some((i) => i.role === 'tool' && i.ok)).toBe(true)
    expect(result.current.items.some((i) => i.text === 'Done.')).toBe(true)

    // The next turn resends the held history: it must pair the confirmed tool_use with the
    // tool_result the server executed (appended server-side only, never re-echoed). Without
    // the pairing the history has a dangling tool_use and the real API rejects it with a 400.
    act(() => result.current.send('thanks'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const third = sentBody(2)
    expect(third.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ])
    expect(third.messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_9',
          content: 'Moved to the trash "Call dentist".',
          is_error: false,
        },
      ],
    })
  })

  // The SSE turn that halts on a destructive delete — shared by the typed-answer tests below.
  const pendingDeleteSse = () =>
    sseResponse([
      {
        type: 'tool-pending-confirmation',
        tool_use_id: 'toolu_9',
        name: 'delete_task',
        input: { task_id: 't1' },
        summary: 'Move "Call dentist" to the trash',
        messages: [
          { role: 'user', content: 'remove dentist' },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'toolu_9', name: 'delete_task', input: { task_id: 't1' } },
            ],
          },
        ],
      },
      { type: 'done', stop_reason: 'awaiting-confirmation' },
    ])
  const endTurnSse = () =>
    sseResponse([
      { type: 'message', role: 'assistant', content: [] },
      { type: 'done', stop_reason: 'end_turn' },
    ])

  it('typed "yes" while pending confirms: re-sends with the approved id', async () => {
    fetchMock.mockResolvedValueOnce(pendingDeleteSse()).mockResolvedValueOnce(endTurnSse())

    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('remove dentist'))
    await waitFor(() => expect(result.current.pending).not.toBeNull())

    act(() => result.current.send('yes!'))
    await waitFor(() => expect(result.current.pending).toBeNull())
    await waitFor(() => expect(result.current.busy).toBe(false))

    expect(sentBody(1).approvedToolUseIds).toEqual(['toolu_9'])
    // The typed answer shows as the user's bubble, then the Confirmed note.
    const texts = result.current.items.map((i) => i.text)
    expect(texts).toContain('yes!')
    expect(texts).toContain('Confirmed.')
  })

  it('typed "no" while pending declines with a plain declined tool_result', async () => {
    fetchMock.mockResolvedValueOnce(pendingDeleteSse()).mockResolvedValueOnce(endTurnSse())

    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('remove dentist'))
    await waitFor(() => expect(result.current.pending).not.toBeNull())

    act(() => result.current.send('no'))
    await waitFor(() => expect(result.current.busy).toBe(false))

    expect(sentBody(1).approvedToolUseIds).toEqual([])
    const last = sentBody(1).messages.at(-1)!
    expect(last.role).toBe('user')
    // A bare "no" adds no extra words — just the declined tool_result.
    expect(last.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_9',
        content: 'User declined this action.',
        is_error: true,
      },
    ])
    expect(result.current.items.map((i) => i.text)).toContain('Declined.')
  })

  it('any other typed reply while pending declines AND passes the words to the model', async () => {
    fetchMock.mockResolvedValueOnce(pendingDeleteSse()).mockResolvedValueOnce(endTurnSse())

    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('remove dentist'))
    await waitFor(() => expect(result.current.pending).not.toBeNull())

    act(() => result.current.send('actually just rename it to "call dr smith"'))
    await waitFor(() => expect(result.current.busy).toBe(false))

    const last = sentBody(1).messages.at(-1)!
    expect(last.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_9',
        content: 'User declined this action.',
        is_error: true,
      },
      { type: 'text', text: 'actually just rename it to "call dr smith"' },
    ])
  })

  it('merges sibling tool results from one turn into a single user turn', async () => {
    // A turn mixing a destructive and a non-destructive tool pauses before executing EITHER
    // (atomic pre-scan); after confirm both run. The API requires every tool_use in a turn to
    // be answered in the SINGLE next user message.
    fetchMock
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: 'tool-pending-confirmation',
            tool_use_id: 'toolu_del',
            name: 'delete_task',
            input: { task_id: 't1' },
            summary: 'Move "Old note" to the trash',
            messages: [
              { role: 'user', content: 'clean up' },
              {
                role: 'assistant',
                content: [
                  {
                    type: 'tool_use',
                    id: 'toolu_del',
                    name: 'delete_task',
                    input: { task_id: 't1' },
                  },
                  { type: 'tool_use', id: 'toolu_add', name: 'create_task', input: { text: 'x' } },
                ],
              },
            ],
          },
          { type: 'done', stop_reason: 'awaiting-confirmation' },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: 'tool-result',
            tool_use_id: 'toolu_del',
            name: 'delete_task',
            ok: true,
            summary: 'Moved to the trash "Old note".',
          },
          {
            type: 'tool-result',
            tool_use_id: 'toolu_add',
            name: 'create_task',
            ok: true,
            summary: 'Added "x".',
          },
          { type: 'message', role: 'assistant', content: [] },
          { type: 'done', stop_reason: 'end_turn' },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: 'message', role: 'assistant', content: [] },
          { type: 'done', stop_reason: 'end_turn' },
        ]),
      )

    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('clean up'))
    await waitFor(() => expect(result.current.pending).not.toBeNull())
    act(() => result.current.confirm())
    await waitFor(() => expect(result.current.busy).toBe(false))

    act(() => result.current.send('next'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const third = sentBody(2)
    expect(third.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ])
    expect(third.messages[2]!.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_del',
        content: 'Moved to the trash "Old note".',
        is_error: false,
      },
      { type: 'tool_result', tool_use_id: 'toolu_add', content: 'Added "x".', is_error: false },
    ])
  })

  it("adopts the server-authoritative history so BabyClaw's own tool turns survive the next turn", async () => {
    // The memory fix: the server returns the FULL conversation (its own tool_use/tool_result turns
    // included) as `history` on the `message` event; the client adopts it wholesale, so the NEXT
    // resend carries what BabyClaw actually did instead of only its prose — no more denying its own
    // create_task on a follow-up turn (the confabulation bug).
    const authoritative = [
      { role: 'user', content: 'add vacuum house recurring' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'On it.' },
          { type: 'tool_use', id: 'toolu_c', name: 'create_task', input: { text: 'Vacuum house' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_c',
            content: 'Created "Vacuum house" (id t9).',
            is_error: false,
          },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Done — recurring every 2 weeks.' }] },
    ]
    fetchMock
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: 'tool-result',
            tool_use_id: 'toolu_c',
            name: 'create_task',
            ok: true,
            summary: 'Created "Vacuum house" (id t9).',
            display: 'Created "Vacuum house" on the grid.',
          },
          { type: 'text-delta', text: 'Done — recurring every 2 weeks.' },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Done — recurring every 2 weeks.' }],
            history: authoritative,
          },
          { type: 'done', stop_reason: 'end_turn' },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: 'message', role: 'assistant', content: [], history: [] },
          { type: 'done', stop_reason: 'end_turn' },
        ]),
      )

    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('add vacuum house recurring'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    // The tool receipt still shows in the UI…
    expect(result.current.items.some((i) => i.role === 'tool')).toBe(true)

    act(() => result.current.send('why did you make it recurring?'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    // …and now the RESENT history carries the tool_use + tool_result turns the server reported.
    const sent = sentBody(1).messages
    expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    const toolUseTurn = sent[1]!.content as { type: string; name?: string }[]
    expect(toolUseTurn.some((b) => b.type === 'tool_use' && b.name === 'create_task')).toBe(true)
    const toolResultTurn = sent[2]!.content as { type: string }[]
    expect(toolResultTurn.some((b) => b.type === 'tool_result')).toBe(true)
  })

  it('without a history sync, falls back to appending the assistant turn', async () => {
    // Back-compat: a `message` event with no `history` (a response with no tool turns to preserve)
    // appends the assistant turn, keeping the resend user-first and alternating.
    fetchMock
      .mockResolvedValueOnce(
        sseResponse([
          { type: 'text-delta', text: 'Hi there.' },
          { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Hi there.' }] },
          { type: 'done', stop_reason: 'end_turn' },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: 'message', role: 'assistant', content: [], history: [] },
          { type: 'done', stop_reason: 'end_turn' },
        ]),
      )

    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('hi'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    act(() => result.current.send('again'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(sentBody(1).messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('rolls back the optimistic user turn when a turn fails, so the next send does not desync', async () => {
    // A pre-stream failure (e.g. 429) must not leave a dangling user turn: without rollback the next
    // send appends a SECOND user turn, breaking Anthropic's user/assistant alternation and wedging
    // the chat. After rollback the retry carries a single, clean user-first turn.
    fetchMock.mockResolvedValueOnce(sseResponse([], 429)).mockResolvedValueOnce(
      sseResponse([
        { type: 'text-delta', text: 'Hi!' },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi!' }],
          history: [
            { role: 'user', content: 'hello again' },
            { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
          ],
        },
        { type: 'done', stop_reason: 'end_turn' },
      ]),
    )

    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('hello'))
    await waitFor(() => expect(result.current.error).toMatch(/rate limit/i))

    act(() => result.current.send('hello again'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const sent = sentBody(1).messages
    expect(sent.map((m) => m.role)).toEqual(['user'])
    expect(sent[0]!.content).toBe('hello again')
  })

  it('maps the pre-stream budget kill-switch (HTTP 503) to the paused message', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([], 503))
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('hi'))
    await waitFor(() => expect(result.current.error).toMatch(/paused for this month/i))
  })

  it('maps the pre-stream rate limit (HTTP 429) to the slow-down message', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([], 429))
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('hi'))
    await waitFor(() => expect(result.current.error).toMatch(/rate limit/i))
  })

  it('shows the generic failure for in-band error events', async () => {
    // The only codes the server emits in-band are 'tool-loop-cap' and 'chat_failed' — budget
    // and rate-limit rejections arrive pre-stream as HTTP statuses (tested above).
    fetchMock.mockResolvedValueOnce(sseResponse([{ type: 'error', code: 'tool-loop-cap' }]))
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('hi'))
    await waitFor(() => expect(result.current.error).toBe('Chat failed.'))
  })

  it('maps the pre-stream input cap (HTTP 413) to the too-long message', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([], 413))
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('hi'))
    await waitFor(() => expect(result.current.error).toMatch(/too long/i))
  })

  it('live-refresh: invalidates the mutated data domains on a successful tool-result', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        {
          type: 'tool-result',
          tool_use_id: 't1',
          name: 'create_task',
          ok: true,
          summary: 'Created "x".',
          mutated: ['tasks', 'daily_state'],
        },
        { type: 'text-delta', text: 'Added it.' },
        { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Added it.' }] },
        { type: 'done', stop_reason: 'end_turn' },
      ]),
    )
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('add x'))
    await waitFor(() => expect(result.current.busy).toBe(false))

    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey)
    expect(keys).toContainEqual(['tasks'])
    expect(keys).toContainEqual(['daily_state'])
  })

  it('live-refresh: does NOT invalidate on a FAILED tool-result', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        {
          type: 'tool-result',
          tool_use_id: 't1',
          name: 'delete_task',
          ok: false,
          summary: "I couldn't find that task.",
          mutated: ['tasks'],
        },
        { type: 'message', role: 'assistant', content: [] },
        { type: 'done', stop_reason: 'end_turn' },
      ]),
    )
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('delete y'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('shows the user-facing display, never the model-facing summary (no ids leak)', async () => {
    // create_task sends the id-bearing text as `summary` (the model needs it to chain a follow-up)
    // and a clean sentence as `display` — only the latter should reach the chat panel.
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        {
          type: 'tool-result',
          tool_use_id: 't1',
          name: 'create_task',
          ok: true,
          summary: 'Created "SCP" on the grid (id 07bc0a9b-ced6-4608-99e7-3a930ba9abf1).',
          display: 'Created "SCP" on the grid.',
          mutated: ['tasks'],
        },
        { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        { type: 'done', stop_reason: 'end_turn' },
      ]),
    )
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('add SCP'))
    await waitFor(() => expect(result.current.busy).toBe(false))

    const tool = result.current.items.find((i) => i.role === 'tool')
    expect(tool?.text).toBe('Created "SCP" on the grid.')
    expect(result.current.items.some((i) => i.text.includes('07bc0a9b'))).toBe(false)
  })

  it('hides internal read-only lookups (display: null) from the chat', async () => {
    // list_tasks streams the raw row JSON as `summary` for the model but display: null — the user
    // should see no bubble for it, only the assistant's plain reply.
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        {
          type: 'tool-result',
          tool_use_id: 't1',
          name: 'list_tasks',
          ok: true,
          summary: '[{"id":"07bc0a9b","text":"SCP","x":0.9,"y":0.75}]',
          display: null,
        },
        { type: 'text-delta', text: 'You have 1 task.' },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'You have 1 task.' }],
        },
        { type: 'done', stop_reason: 'end_turn' },
      ]),
    )
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('what do I have?'))
    await waitFor(() => expect(result.current.busy).toBe(false))

    expect(result.current.items.some((i) => i.role === 'tool')).toBe(false)
    expect(result.current.items.some((i) => i.text.includes('07bc0a9b'))).toBe(false)
  })
})
