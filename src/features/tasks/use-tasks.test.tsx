import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ToastProvider } from '../../components/use-toast'

// These tests cover the ONE thing the shared task mutations add over a bare useMutation: an onError
// that surfaces a toast. A failed write used to resolve silently (the "toggle does nothing" symptom
// PR #240 chased), so the guard here is that a failing PATCH/INSERT shows a visible notice and a
// succeeding one shows nothing. The mutationFn's own supabase-shape / invalidation is covered by
// the migration + higher-level component tests; here we only flip the terminal resolver to error.
const updateEq = vi.fn() // from('tasks').update(patch).eq('id', id)  → { error }
const single = vi.fn() //   from('tasks').insert(row).select('*').single() → { data, error }
const select = vi.fn(() => ({ single }))
const insert = vi.fn(() => ({ select }))
const update = vi.fn(() => ({ eq: updateEq }))
const from = vi.fn(() => ({ update, insert }))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => from() },
}))

import { useAddTask, useSoftDeleteTask, useUpdateTask } from './use-tasks'

// The hook under test renders alongside the ToastProvider's <Snackbar>, so a fired toast lands in
// the document (portaled to <body>) where screen queries can see it.
function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
  return { wrapper }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('task mutations surface write failures', () => {
  it('useUpdateTask toasts when the write fails', async () => {
    updateEq.mockResolvedValue({ error: { message: 'boom' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateTask(), { wrapper })

    result.current.mutate({ id: 't1', patch: { text: 'x' } })

    expect(await screen.findByText("Couldn't save your change — try again.")).toBeInTheDocument()
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('useUpdateTask shows NO toast when the write succeeds', async () => {
    updateEq.mockResolvedValue({ error: null })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateTask(), { wrapper })

    result.current.mutate({ id: 't1', patch: { text: 'x' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(screen.queryByText(/try again/)).not.toBeInTheDocument()
  })

  it('useAddTask toasts when the insert fails', async () => {
    single.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useAddTask(), { wrapper })

    result.current.mutate('New task')

    expect(await screen.findByText("Couldn't add that task — try again.")).toBeInTheDocument()
  })

  it('useSoftDeleteTask toasts when the write fails', async () => {
    updateEq.mockResolvedValue({ error: { message: 'boom' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSoftDeleteTask(), { wrapper })

    result.current.mutate('t1')

    expect(await screen.findByText("Couldn't delete that task — try again.")).toBeInTheDocument()
  })
})
