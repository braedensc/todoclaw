import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// We mock the Supabase client so the hooks exercise their query/rpc + invalidation logic
// under jsdom with no network. The REAL rpc behaviour (atomic jsonb merge, history insert)
// is exercised by applying the migration, not here — these tests assert the hooks call the
// right rpc with the right args and invalidate the right query keys.
const rpc = vi.fn<(name: string, params: unknown) => unknown>()
const order = vi.fn()
const select = vi.fn(() => ({ order }))
const from = vi.fn<(table: string) => unknown>(() => ({ select }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, params: unknown) => rpc(name, params),
    from: (table: string) => from(table),
  },
}))

// Pin the user-local date so we can assert p_date / the invalidated daily_state key.
vi.mock('../../lib/dates', () => ({
  localDateInTZ: () => '2026-06-23',
}))

import { useHistory, useMarkTaskDone, useRestoreTask } from './use-history'

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { wrapper, invalidateSpy }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useHistory', () => {
  it('selects all history newest-first and parses the rows', async () => {
    const row = {
      id: 'h1',
      user_id: 'u1',
      task_id: 't1',
      text: 'Ship PR6',
      bucket: 'oneoff',
      completed_at: '2026-06-23T12:00:00.000Z',
      created_at: '2026-06-23T12:00:00.000Z',
    }
    order.mockResolvedValue({ data: [row], error: null })

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useHistory(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(from).toHaveBeenCalledWith('history')
    expect(order).toHaveBeenCalledWith('completed_at', { ascending: false })
    expect(result.current.data).toEqual([row])
  })
})

describe('useMarkTaskDone', () => {
  it('calls set_task_done with the snapshot + user-local date and invalidates history + today', async () => {
    rpc.mockResolvedValue({ error: null })
    const { wrapper, invalidateSpy } = makeWrapper()
    const { result } = renderHook(() => useMarkTaskDone(), { wrapper })

    result.current.mutate({ taskId: 't1', text: 'Ship PR6', bucket: 'oneoff', timeZone: 'UTC' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(rpc).toHaveBeenCalledWith('set_task_done', {
      p_date: '2026-06-23',
      p_task_id: 't1',
      p_text: 'Ship PR6',
      p_bucket: 'oneoff',
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['history'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['daily_state', '2026-06-23'] })
  })

  it('throws when the rpc errors', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMarkTaskDone(), { wrapper })

    result.current.mutate({ taskId: 't1', text: 'x', bucket: null, timeZone: 'UTC' })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useRestoreTask', () => {
  it('calls set_task_undone and invalidates ONLY today (history is permanent)', async () => {
    rpc.mockResolvedValue({ error: null })
    const { wrapper, invalidateSpy } = makeWrapper()
    const { result } = renderHook(() => useRestoreTask(), { wrapper })

    result.current.mutate({ taskId: 't1', timeZone: 'UTC' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(rpc).toHaveBeenCalledWith('set_task_undone', {
      p_date: '2026-06-23',
      p_task_id: 't1',
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['daily_state', '2026-06-23'] })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['history'] })
  })
})
