import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Mock the Supabase client (session token only; the function is mocked via fetch).
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}))

import { useAiChat } from './use-ai-chat'

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

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
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

    const { result } = renderHook(() => useAiChat())
    act(() => result.current.send('add a task'))

    await waitFor(() => expect(result.current.busy).toBe(false))
    const roles = result.current.items.map((i) => i.role)
    expect(roles).toEqual(['user', 'assistant'])
    expect(result.current.items[0]!.text).toBe('add a task')
    expect(result.current.items[1]!.text).toBe('Added it.')
  })

  it('pauses on a destructive tool, then runs it after confirm', async () => {
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
            messages: [{ role: 'user', content: 'remove dentist' }],
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

    const { result } = renderHook(() => useAiChat())
    act(() => result.current.send('remove dentist'))

    await waitFor(() =>
      expect(result.current.pending?.summary).toBe('Move "Call dentist" to the trash'),
    )

    act(() => result.current.confirm())
    await waitFor(() => expect(result.current.pending).toBeNull())
    await waitFor(() => expect(result.current.busy).toBe(false))

    // Second request carried the approved id.
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body)
    expect(secondBody.approvedToolUseIds).toEqual(['toolu_9'])
    // The executed tool note + the follow-up text are shown.
    expect(result.current.items.some((i) => i.role === 'tool' && i.ok)).toBe(true)
    expect(result.current.items.some((i) => i.text === 'Done.')).toBe(true)
  })

  it('surfaces a budget-exhausted error from the stream', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([{ type: 'error', code: 'budget-exhausted' }]))
    const { result } = renderHook(() => useAiChat())
    act(() => result.current.send('hi'))
    await waitFor(() => expect(result.current.error).toMatch(/paused for this month/i))
  })
})
