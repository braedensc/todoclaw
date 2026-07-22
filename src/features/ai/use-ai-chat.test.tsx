import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// The transcript is server-authoritative now: the client sends a single { session_id, message } or
// { session_id, action } — never history. We mock the Supabase table reads (session list + a
// session's persisted messages) so the hook's resume/hydrate path runs, and mock the Edge Function
// via fetch (SSE body).
type Row = Record<string, unknown>
let sessionsData: Row[] = []
let messagesData: Row[] = []

vi.mock('../../lib/supabase', () => {
  const chain = (rows: Row[]) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b
    // Thenable: awaiting any point in the chain resolves the rows.
    b.then = (res: (v: { data: Row[]; error: null }) => unknown) => res({ data: rows, error: null })
    return b
  }
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
      from: (table: string) => chain(table === 'chat_sessions' ? sessionsData : messagesData),
    },
  }
})

import { useAiChat } from './use-ai-chat'

let queryClient: QueryClient
let invalidateSpy: ReturnType<typeof vi.fn>
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

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

// An SSE response held open by the test — events are emitted on demand, so a "switch conversations
// while BabyClaw is still thinking" moment can be frozen mid-stream and inspected.
function controlledSse() {
  const enc = new TextEncoder()
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c
    },
  })
  return {
    response: { ok: true, status: 200, body } as unknown as Response,
    emit: (e: object) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)),
    close: () => ctrl.close(),
  }
}

const fetchMock = vi.fn()
const sentBody = (call: number) =>
  JSON.parse(fetchMock.mock.calls[call]![1].body) as {
    session_id: string | null
    message?: string
    seed?: string
    action?: { type: 'confirm' | 'deny'; tool_use_id: string; note?: string }
  }

beforeEach(() => {
  sessionsData = []
  messagesData = []
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  invalidateSpy = vi.fn()
  queryClient.invalidateQueries = invalidateSpy as unknown as typeof queryClient.invalidateQueries
})
afterEach(() => vi.unstubAllGlobals())

const session = (id: string) => ({ type: 'session', session_id: id })
const endTurn = () => [
  { type: 'message', role: 'assistant', content: [] },
  { type: 'done', stop_reason: 'end_turn' },
]

describe('useAiChat', () => {
  it('sends { session_id: null, message } for a fresh chat and streams into an assistant bubble', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        session('sess_1'),
        { type: 'text-delta', text: 'Added ' },
        { type: 'text-delta', text: 'it.' },
        ...endTurn(),
      ]),
    )

    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('add a task'))

    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(sentBody(0)).toMatchObject({ session_id: null, message: 'add a task' })
    const roles = result.current.items.map((i) => i.role)
    expect(roles).toEqual(['user', 'assistant'])
    expect(result.current.items[0]!.text).toBe('add a task')
    expect(result.current.items[1]!.text).toBe('Added it.')
  })

  it('adopts the session id from the `session` event so the NEXT send targets it', async () => {
    fetchMock
      .mockResolvedValueOnce(
        sseResponse([session('sess_42'), { type: 'text-delta', text: 'ok' }, ...endTurn()]),
      )
      .mockResolvedValueOnce(sseResponse([session('sess_42'), ...endTurn()]))

    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('hi'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    act(() => result.current.send('again'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(sentBody(0).session_id).toBeNull()
    expect(sentBody(1)).toMatchObject({ session_id: 'sess_42', message: 'again' })
  })

  it('folds a seed into the first turn as `seed`, showing the bare words as the bubble', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([session('s'), ...endTurn()]))
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.seed('Your plan: focus on the deck.'))
    act(() => result.current.send('what should I do first?'))
    await waitFor(() => expect(result.current.busy).toBe(false))

    const body = sentBody(0)
    expect(body.message).toBe('what should I do first?')
    expect(body.seed).toBe('Your plan: focus on the deck.')
  })

  const pendingDeleteSse = () =>
    sseResponse([
      session('sess_d'),
      { type: 'text-delta', text: "I'll delete it." },
      {
        type: 'tool-pending-confirmation',
        tool_use_id: 'toolu_9',
        name: 'delete_task',
        summary: 'Move "Call dentist" to the trash',
      },
      { type: 'done', stop_reason: 'awaiting-confirmation' },
    ])

  it('pauses on a destructive tool, then confirm() sends a confirm action for that session', async () => {
    fetchMock.mockResolvedValueOnce(pendingDeleteSse()).mockResolvedValueOnce(
      sseResponse([
        {
          type: 'tool-result',
          tool_use_id: 'toolu_9',
          name: 'delete_task',
          ok: true,
          summary: 'Moved to the trash "Call dentist".',
        },
        { type: 'text-delta', text: 'Done.' },
        ...endTurn(),
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

    expect(sentBody(1)).toEqual({
      session_id: 'sess_d',
      action: { type: 'confirm', tool_use_id: 'toolu_9' },
    })
    expect(result.current.items.some((i) => i.role === 'tool' && i.ok)).toBe(true)
    expect(result.current.items.some((i) => i.text === 'Done.')).toBe(true)
  })

  it('deny() sends a deny action for the pending id', async () => {
    fetchMock
      .mockResolvedValueOnce(pendingDeleteSse())
      .mockResolvedValueOnce(sseResponse([...endTurn()]))
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('remove dentist'))
    await waitFor(() => expect(result.current.pending).not.toBeNull())

    act(() => result.current.deny())
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(sentBody(1)).toEqual({
      session_id: 'sess_d',
      action: { type: 'deny', tool_use_id: 'toolu_9' },
    })
    expect(result.current.items.map((i) => i.text)).toContain('Declined.')
  })

  it('typed "yes" while pending confirms via an action', async () => {
    fetchMock
      .mockResolvedValueOnce(pendingDeleteSse())
      .mockResolvedValueOnce(sseResponse([...endTurn()]))
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('remove dentist'))
    await waitFor(() => expect(result.current.pending).not.toBeNull())

    act(() => result.current.send('yes!'))
    await waitFor(() => expect(result.current.pending).toBeNull())
    await waitFor(() => expect(result.current.busy).toBe(false))

    expect(sentBody(1).action).toEqual({ type: 'confirm', tool_use_id: 'toolu_9' })
    const texts = result.current.items.map((i) => i.text)
    expect(texts).toContain('yes!')
    expect(texts).toContain('Confirmed.')
  })

  it('typed "no" while pending denies with no note', async () => {
    fetchMock
      .mockResolvedValueOnce(pendingDeleteSse())
      .mockResolvedValueOnce(sseResponse([...endTurn()]))
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('remove dentist'))
    await waitFor(() => expect(result.current.pending).not.toBeNull())

    act(() => result.current.send('no'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(sentBody(1).action).toEqual({ type: 'deny', tool_use_id: 'toolu_9' })
    expect(result.current.items.map((i) => i.text)).toContain('Declined.')
  })

  it('any other typed reply while pending denies AND forwards the words as the note', async () => {
    fetchMock
      .mockResolvedValueOnce(pendingDeleteSse())
      .mockResolvedValueOnce(sseResponse([...endTurn()]))
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('remove dentist'))
    await waitFor(() => expect(result.current.pending).not.toBeNull())

    act(() => result.current.send('actually just rename it to "call dr smith"'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(sentBody(1).action).toEqual({
      type: 'deny',
      tool_use_id: 'toolu_9',
      note: 'actually just rename it to "call dr smith"',
    })
  })

  it('resumes the most-recent session (< 24h) and hydrates its base + a mid-flight confirmation', async () => {
    sessionsData = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Yesterday chat',
        updated_at: new Date().toISOString(),
        origin: 'user',
        kind: null,
        pending: {
          awaiting: { tool_use_id: 'toolu_p', name: 'delete_task', summary: 'Delete "X"' },
          approved: [],
        },
      },
    ]
    messagesData = [
      { seq: 1, role: 'user', content: 'delete X' },
      { seq: 2, role: 'assistant', content: [{ type: 'text', text: 'Sure — confirm?' }] },
    ]
    fetchMock.mockResolvedValueOnce(sseResponse([...endTurn()]))

    const { result } = renderHook(() => useAiChat(), { wrapper })
    // The persisted base renders, and the pending confirm is surfaced from the row.
    await waitFor(() => expect(result.current.items.some((i) => i.text === 'delete X')).toBe(true))
    await waitFor(() => expect(result.current.pending?.summary).toBe('Delete "X"'))

    // Confirming targets the resumed session id (not null).
    act(() => result.current.confirm())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentBody(0)).toMatchObject({
      session_id: '11111111-1111-4111-8111-111111111111',
      action: { type: 'confirm', tool_use_id: 'toolu_p' },
    })
  })

  it('does NOT resume a stale session (> 24h) — starts fresh', async () => {
    sessionsData = [
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Old',
        updated_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        origin: 'user',
        kind: null,
        pending: null,
      },
    ]
    fetchMock.mockResolvedValueOnce(sseResponse([session('new'), ...endTurn()]))
    const { result } = renderHook(() => useAiChat(), { wrapper })
    await waitFor(() => expect(result.current).toBeTruthy())
    act(() => result.current.send('hi'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(sentBody(0).session_id).toBeNull()
  })

  it('does NOT auto-resume a proactive (inbox) session — only person-started chats resume', async () => {
    // The most-recent session is a fresh morning-plan (proactive). It must NOT become the resumed
    // conversation — those are opened deliberately via their deep link — so sending starts a new chat.
    sessionsData = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Morning plan',
        updated_at: new Date().toISOString(),
        origin: 'proactive',
        kind: 'plan',
        pending: null,
      },
    ]
    fetchMock.mockResolvedValueOnce(sseResponse([session('new'), ...endTurn()]))
    const { result } = renderHook(() => useAiChat(), { wrapper })
    await waitFor(() => expect(result.current).toBeTruthy())
    // Not resumed: the persisted proactive base is NOT hydrated and no pending is surfaced.
    expect(result.current.items).toHaveLength(0)
    act(() => result.current.send('hi'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(sentBody(0).session_id).toBeNull()
  })

  it('maps pre-stream 503 / 429 / 413 to their messages', async () => {
    for (const [status, re] of [
      [503, /paused for this month/i],
      [429, /rate limit/i],
      [413, /too long/i],
    ] as const) {
      fetchMock.mockResolvedValueOnce(sseResponse([], status))
      const { result } = renderHook(() => useAiChat(), { wrapper })
      act(() => result.current.send('hi'))
      await waitFor(() => expect(result.current.error).toMatch(re))
    }
  })

  it('shows the generic failure for an in-band error event', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([session('s'), { type: 'error', code: 'tool-loop-cap' }]),
    )
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('hi'))
    await waitFor(() => expect(result.current.error).toBe('Chat failed.'))
  })

  it('clears pending and surfaces the message on a stale_confirmation error', async () => {
    fetchMock.mockResolvedValueOnce(pendingDeleteSse()).mockResolvedValueOnce(
      sseResponse([
        session('sess_d'),
        {
          type: 'error',
          code: 'stale_confirmation',
          message: 'That was already handled — refresh to continue.',
        },
      ]),
    )
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('remove dentist'))
    await waitFor(() => expect(result.current.pending).not.toBeNull())
    act(() => result.current.confirm())
    await waitFor(() => expect(result.current.pending).toBeNull())
    expect(result.current.error).toMatch(/already handled/i)
  })

  it('keeps multi-step narration in SEPARATE bubbles (a tool result ends the prior bubble)', async () => {
    // "On it." (tool_use turn) → create_task → "All set!" (terminal turn) must render as two distinct
    // assistant bubbles with the tool line between them — matching the reloaded transcript — not one
    // run-on bubble before the tool line.
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        session('s'),
        { type: 'text-delta', text: 'On it.' },
        {
          type: 'tool-result',
          tool_use_id: 't1',
          name: 'create_task',
          ok: true,
          summary: 'Created "x".',
          display: 'Created "x".',
        },
        { type: 'text-delta', text: 'All set!' },
        ...endTurn(),
      ]),
    )
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('add x'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(result.current.items.map((i) => `${i.role}:${i.text}`)).toEqual([
      'user:add x',
      'assistant:On it.',
      'tool:Created "x".',
      'assistant:All set!',
    ])
  })

  it('live-refresh: invalidates the mutated data domains on a successful tool-result', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        session('s'),
        {
          type: 'tool-result',
          tool_use_id: 't1',
          name: 'create_task',
          ok: true,
          summary: 'Created "x".',
          mutated: ['tasks', 'daily_state'],
        },
        { type: 'text-delta', text: 'Added it.' },
        ...endTurn(),
      ]),
    )
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('add x'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey)
    expect(keys).toContainEqual(['tasks'])
    expect(keys).toContainEqual(['daily_state'])
  })

  it('live-refresh: a FAILED tool-result does not invalidate its data domain', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        session('s'),
        {
          type: 'tool-result',
          tool_use_id: 't1',
          name: 'delete_task',
          ok: false,
          summary: "I couldn't find that task.",
          mutated: ['tasks'],
        },
        ...endTurn(),
      ]),
    )
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('delete y'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey)
    expect(keys).not.toContainEqual(['tasks']) // the done event still refreshes ['chat_sessions']
  })

  it('shows the user-facing display, never the model-facing summary (no ids leak)', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        session('s'),
        {
          type: 'tool-result',
          tool_use_id: 't1',
          name: 'create_task',
          ok: true,
          summary: 'Created "SCP" on the grid (id 07bc0a9b-ced6-4608-99e7-3a930ba9abf1).',
          display: 'Created "SCP" on the grid.',
          mutated: ['tasks'],
        },
        { type: 'text-delta', text: 'Done.' },
        ...endTurn(),
      ]),
    )
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('add SCP'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    const tool = result.current.items.find((i) => i.role === 'tool')
    expect(tool?.text).toBe('Created "SCP" on the grid.')
    expect(result.current.items.some((i) => i.text.includes('07bc0a9b'))).toBe(false)
  })

  it('reopening a session mid-stream keeps the turn: live bubbles are wiped but the transcript refetches, again when the backgrounded turn lands', async () => {
    // THE vanishing-message repro: send, leave the chat while BabyClaw is thinking, come back via
    // the session list. Before the fix the reopened transcript served a stale cached base (missing
    // the new turns) after wiping the live bubbles — the message looked like it never happened.
    const stream = controlledSse()
    fetchMock.mockResolvedValueOnce(stream.response)
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('is my car task set?'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => {
      stream.emit(session('sess_bg'))
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.sessionId).toBe('sess_bg'))

    // Leave + reopen the same conversation (mobile: bottom-nav Chat → tap the session card).
    act(() => result.current.openSession('sess_bg'))
    expect(result.current.busy).toBe(false)
    expect(result.current.items.filter((i) => i.role === 'user')).toHaveLength(0) // live wipe…
    const keys = () =>
      invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey)
    expect(keys()).toContainEqual(['chat_messages', 'sess_bg']) // …but the base refetches with it

    // The backgrounded stream finishes: nothing paints and no error surfaces, but the transcript is
    // marked stale again so the finished reply appears in the (re)opened conversation.
    invalidateSpy.mockClear()
    await act(async () => {
      stream.emit({ type: 'text-delta', text: 'ghost delta' })
      stream.emit({ type: 'message', role: 'assistant', content: [] })
      stream.emit({ type: 'done', stop_reason: 'end_turn' })
      stream.close()
      await Promise.resolve()
    })
    await waitFor(() => expect(keys()).toContainEqual(['chat_messages', 'sess_bg']))
    expect(result.current.items.some((i) => i.text === 'ghost delta')).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('switching to ANOTHER conversation mid-stream backgrounds the old one: busy clears, nothing paints, errors are silenced, data refreshes still run', async () => {
    const stream = controlledSse()
    fetchMock.mockResolvedValueOnce(stream.response)
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('slow question'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => {
      stream.emit(session('sess_a'))
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.sessionId).toBe('sess_a'))

    const other = '44444444-4444-4444-8444-444444444444'
    act(() => result.current.openSession(other))
    // The opened conversation isn't send-blocked by the turn still running elsewhere.
    expect(result.current.busy).toBe(false)

    await act(async () => {
      stream.emit({ type: 'text-delta', text: 'too late' })
      stream.emit({
        type: 'tool-result',
        tool_use_id: 't1',
        name: 'create_task',
        ok: true,
        summary: 'Created "x".',
        mutated: ['tasks'],
      })
      stream.emit({ type: 'error', code: 'tool-loop-cap' })
      stream.close()
      await Promise.resolve()
    })
    // `keys` re-reads the spy inside waitFor — a one-shot snapshot can never observe a call that
    // lands a tick later, turning the wait into a coin flip.
    const keys = () =>
      invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey)
    await waitFor(() => expect(keys()).toContainEqual(['tasks'])) // the task really was created
    expect(result.current.sessionId).toBe(other) // the backgrounded session event didn't yank us back
    expect(result.current.items.some((i) => i.text === 'too late')).toBe(false)
    expect(result.current.items.some((i) => i.role === 'tool')).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('a confirmation that halts AFTER the user reopened the session still paints', async () => {
    // The halt event arrives on a "backgrounded" stream whose session the user has ALREADY come
    // back to — no later openSession will restore it from the session row, so the event itself
    // must paint the confirm card (or the destructive action silently stalls).
    const stream = controlledSse()
    fetchMock.mockResolvedValueOnce(stream.response)
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('delete my dentist task'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => {
      stream.emit(session('sess_p'))
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.sessionId).toBe('sess_p'))

    // Leave and come back before the halt arrives (the row snapshot knows nothing yet).
    act(() => result.current.openSession('sess_p'))
    expect(result.current.pending).toBeNull()

    await act(async () => {
      stream.emit({
        type: 'tool-pending-confirmation',
        tool_use_id: 'toolu_x',
        name: 'delete_task',
        summary: 'Delete "Dentist"',
      })
      stream.emit({ type: 'done', stop_reason: 'awaiting-confirmation' })
      stream.close()
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.pending?.summary).toBe('Delete "Dentist"'))
  })

  it('hides internal read-only lookups (display: null) from the chat', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        session('s'),
        {
          type: 'tool-result',
          tool_use_id: 't1',
          name: 'list_tasks',
          ok: true,
          summary: '[{"id":"07bc0a9b"}]',
          display: null,
        },
        { type: 'text-delta', text: 'You have 1 task.' },
        ...endTurn(),
      ]),
    )
    const { result } = renderHook(() => useAiChat(), { wrapper })
    act(() => result.current.send('what do I have?'))
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(result.current.items.some((i) => i.role === 'tool')).toBe(false)
    expect(result.current.items.some((i) => i.text.includes('07bc0a9b'))).toBe(false)
  })
})
