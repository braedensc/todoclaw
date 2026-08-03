import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ToastProvider } from '../../components/use-toast'

// We mock the Supabase client so the hooks exercise their query/rpc + invalidation logic
// under jsdom with no network. The REAL rpc behaviour (atomic jsonb merge, history insert)
// is exercised by applying the migration, not here — these tests assert the hooks call the
// right rpc with the right args and invalidate the right query keys.
const rpc = vi.fn<(name: string, params: unknown) => unknown>()
const order = vi.fn()
const select = vi.fn(() => ({ order }))
const eq = vi.fn()
const del = vi.fn(() => ({ eq }))
const from = vi.fn<(table: string) => unknown>(() => ({ select, delete: del }))

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

import { useDeleteHistoryEntry, useHistory, useMarkTaskDone, useRestoreTask } from './use-history'

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  // Render alongside ToastProvider's <Snackbar> so a failed write's onError toast lands in the
  // document (portaled to <body>) where screen queries can see it.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
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
  it('calls set_task_done with the snapshot + user-local date and invalidates history, today, and tasks', async () => {
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
    // set_task_done now stamps tasks.completed_at, so the tasks query must refetch to drop the
    // completed task from the grid/list/mobile (its permanent, across-day hide).
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] })
  })

  it('throws AND toasts when the rpc errors', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMarkTaskDone(), { wrapper })

    result.current.mutate({ taskId: 't1', text: 'x', bucket: null, timeZone: 'UTC' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(await screen.findByText("Couldn't mark that done — try again.")).toBeInTheDocument()
  })
})

describe('useRestoreTask', () => {
  it('calls set_task_undone and invalidates today + tasks, but NOT history (history is permanent)', async () => {
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
    // set_task_undone clears tasks.completed_at, so the tasks query must refetch to bring the
    // restored task back to the grid.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['history'] })
  })

  it('throws AND toasts when the rpc errors', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useRestoreTask(), { wrapper })

    result.current.mutate({ taskId: 't1', timeZone: 'UTC' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(await screen.findByText("Couldn't restore that task — try again.")).toBeInTheDocument()
  })
})

describe('useDeleteHistoryEntry', () => {
  it('hard-deletes the history row by id and invalidates history', async () => {
    eq.mockResolvedValue({ error: null })
    const { wrapper, invalidateSpy } = makeWrapper()
    const { result } = renderHook(() => useDeleteHistoryEntry(), { wrapper })

    result.current.mutate('h1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(from).toHaveBeenCalledWith('history')
    expect(del).toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith('id', 'h1')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['history'] })
  })

  it('throws AND toasts when the delete errors', async () => {
    eq.mockResolvedValue({ error: { message: 'boom' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useDeleteHistoryEntry(), { wrapper })

    result.current.mutate('h1')
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(await screen.findByText("Couldn't remove that entry — try again.")).toBeInTheDocument()
  })
})
