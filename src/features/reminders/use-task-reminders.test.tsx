import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ToastProvider } from '../../components/use-toast'

// These tests cover the ONE thing the reminder write helpers add over a bare rpc call: an onError
// that surfaces a toast. The picker fires add/remove/clear imperatively (mutate, not awaited), so a
// failing RPC has no return path — without the toast the reminder silently doesn't arm and the user
// believes it's set. The real fire-time / RLS behaviour lives server-side and is not exercised here.
const rpc = vi.fn<(name: string, params: unknown) => unknown>()
const select = vi.fn()
const from = vi.fn(() => ({ select }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, params: unknown) => rpc(name, params),
    from: () => from(),
  },
}))

import { useTaskReminderWrites } from './use-task-reminders'

// Render alongside ToastProvider's <Snackbar> so a failed write's onError toast lands in the
// document (portaled to <body>) where screen queries can see it.
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

describe('reminder writes surface RPC failures', () => {
  it('add toasts when set_task_reminder fails', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useTaskReminderWrites(), { wrapper })

    result.current.add('t1', 30)

    expect(
      await screen.findByText("Couldn't update that reminder — try again."),
    ).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('set_task_reminder', {
      p_task_id: 't1',
      p_offset_minutes: 30,
    })
  })

  it('remove toasts when remove_task_reminder fails', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useTaskReminderWrites(), { wrapper })

    result.current.remove('t1', 30)

    expect(
      await screen.findByText("Couldn't update that reminder — try again."),
    ).toBeInTheDocument()
  })

  it('clear toasts when clear_task_reminder fails', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useTaskReminderWrites(), { wrapper })

    result.current.clear('t1')

    expect(
      await screen.findByText("Couldn't update that reminder — try again."),
    ).toBeInTheDocument()
  })

  it('shows NO toast when the write succeeds', async () => {
    rpc.mockResolvedValue({ error: null })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useTaskReminderWrites(), { wrapper })

    result.current.add('t1', 30)

    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(screen.queryByText(/try again/)).not.toBeInTheDocument()
  })
})
