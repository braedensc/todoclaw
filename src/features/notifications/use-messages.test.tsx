import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'

// The read-state contract for BabyClaw's inbox. The bug this pins: opening a check-in fires
// mark_message_read AND chat_open_for_message concurrently, and the second one used to invalidate
// ['messages'] — so a refetch could land while the mark was still in flight, read the row back as
// unread, and repaint the dot on a chat the user was standing in.

const rpc = vi.fn<(fn: string, args: unknown) => Promise<{ data?: unknown; error: unknown }>>()
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => rpc(fn, args) },
}))

import { useMarkMessageRead, useOpenMessageChat, type InboxMessage } from './use-messages'

const MESSAGES_KEY = ['messages']

const msg = (id: string, over: Partial<InboxMessage> = {}): InboxMessage => ({
  id,
  kind: 'plan',
  local_date: '2026-07-14',
  title: 'Your morning plan',
  body: '1. Ship the deck',
  read_at: null,
  created_at: '2026-07-14T12:00:00.000Z',
  session_id: null,
  ...over,
})

let qc: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
)
const cached = () => qc.getQueryData<InboxMessage[]>(MESSAGES_KEY) ?? []

beforeEach(() => {
  rpc.mockReset()
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  qc.setQueryData(MESSAGES_KEY, [msg('m1'), msg('m2', { read_at: '2026-07-14T13:00:00.000Z' })])
})

describe('useMarkMessageRead', () => {
  it('clears the unread dot immediately, before the RPC resolves', async () => {
    let release!: () => void
    rpc.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ error: null })
      }),
    )
    const { result } = renderHook(() => useMarkMessageRead(), { wrapper })
    act(() => result.current.mutate('m1'))

    await waitFor(() => expect(cached()[0]!.read_at).not.toBeNull())
    expect(rpc).toHaveBeenCalledWith('mark_message_read', { p_id: 'm1' })
    act(() => release())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('leaves other rows alone', async () => {
    rpc.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useMarkMessageRead(), { wrapper })
    act(() => result.current.mutate('m1'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(cached()[1]!.read_at).toBe('2026-07-14T13:00:00.000Z')
  })

  it('rolls the dot back when the write fails — the list never lies about the server', async () => {
    rpc.mockResolvedValue({ error: new Error('nope') })
    const { result } = renderHook(() => useMarkMessageRead(), { wrapper })
    act(() => result.current.mutate('m1'))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(cached()[0]!.read_at).toBeNull()
  })
})

describe('useOpenMessageChat', () => {
  it('patches session_id into the cache without invalidating (and without touching read_at)', async () => {
    // The optimistic mark has already landed in the cache; opening must not undo it.
    qc.setQueryData(MESSAGES_KEY, [msg('m1', { read_at: '2026-07-14T14:00:00.000Z' })])
    rpc.mockResolvedValue({ data: 'sess-1', error: null })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useOpenMessageChat(), { wrapper })
    act(() => result.current.mutate('m1'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(cached()[0]).toMatchObject({
      session_id: 'sess-1',
      read_at: '2026-07-14T14:00:00.000Z',
    })
    // Only the chat list is invalidated — a ['messages'] refetch here is what resurrected the dot.
    for (const call of invalidate.mock.calls)
      expect(call[0]).not.toMatchObject({ queryKey: MESSAGES_KEY })
  })
})
