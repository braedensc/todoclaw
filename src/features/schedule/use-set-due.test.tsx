import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ToastProvider } from '../../components/use-toast'

// These tests pin the default-reminder seed the shared due write adds over a bare task PATCH:
// a task gaining its FIRST due time (and holding no reminders) gets the user's default via
// set_task_reminder, strictly AFTER the task write lands (the RPC computes fire_at from the
// stored row). Every other transition — already timed, clearing, existing rows, Off, config not
// loaded — must leave the reminder set alone, so a deliberately cleared reminder never returns.
//
// The supabase module is mocked at the network seam. The two queries the hook reads
// (user_schedule + task_reminders) are seeded straight into the QueryClient cache; from() serves
// the task UPDATE, the reminders refetch after a seed, and a never-resolving user_schedule read
// for the config-not-loaded case.
const updateEq = vi.fn<(col: string, id: string) => Promise<{ error: unknown }>>()
const update = vi.fn(() => ({ eq: updateEq }))
const rpc = vi.fn<(name: string, params: unknown) => unknown>()

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'tasks') return { update }
      if (table === 'task_reminders') return { select: async () => ({ data: [], error: null }) }
      if (table === 'user_schedule')
        return { select: () => ({ maybeSingle: () => new Promise(() => {}) }) }
      throw new Error(`unexpected table: ${table}`)
    },
    rpc: (name: string, params: unknown) => rpc(name, params),
  },
}))

import { useSetDueWithDefaultReminder } from './use-set-due'

const NO_TIME = { id: 't1', due_time: null }
const TIMED = { id: 't1', due_time: '09:00:00' }

function makeWrapper({
  config,
  reminders = new Map<string, number[]>(),
  scheduleLoaded = true,
}: {
  config?: object
  reminders?: Map<string, number[]>
  scheduleLoaded?: boolean
} = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  // Seed the two reads; when scheduleLoaded is false the user_schedule query stays pending (the
  // from() mock never resolves it), modelling the config read not having landed yet.
  if (scheduleLoaded) qc.setQueryData(['user_schedule'], { config: config ?? {} })
  qc.setQueryData(['task_reminders'], reminders)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
  return { wrapper }
}

/** Let the update promise + .then chain flush so a wrongly-fired seed would have landed. */
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  updateEq.mockResolvedValue({ error: null })
  rpc.mockResolvedValue({ error: null })
})

describe('useSetDueWithDefaultReminder', () => {
  it('seeds the built-in 1-hour default when a task first gains a due time', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSetDueWithDefaultReminder(), { wrapper })

    result.current(NO_TIME, '2026-08-01', '09:00')

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_task_reminder', {
        p_task_id: 't1',
        p_offset_minutes: 60,
      }),
    )
    expect(update).toHaveBeenCalledWith({ due: '2026-08-01', due_time: '09:00' })
    expect(updateEq).toHaveBeenCalledWith('id', 't1')
  })

  it('seeds the configured default instead when the user picked one', async () => {
    const { wrapper } = makeWrapper({ config: { notifications: { reminderDefaultMinutes: 10 } } })
    const { result } = renderHook(() => useSetDueWithDefaultReminder(), { wrapper })

    result.current(NO_TIME, '2026-08-01', '09:00')

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_task_reminder', {
        p_task_id: 't1',
        p_offset_minutes: 10,
      }),
    )
  })

  it('only seeds after the task write has landed', async () => {
    let resolveUpdate!: (v: { error: null }) => void
    updateEq.mockReturnValue(new Promise((r) => (resolveUpdate = r)))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSetDueWithDefaultReminder(), { wrapper })

    result.current(NO_TIME, '2026-08-01', '09:00')
    await flush()
    expect(rpc).not.toHaveBeenCalled()

    resolveUpdate({ error: null })
    await waitFor(() => expect(rpc).toHaveBeenCalled())
  })

  it('never seeds when the user chose Off (null)', async () => {
    const { wrapper } = makeWrapper({ config: { notifications: { reminderDefaultMinutes: null } } })
    const { result } = renderHook(() => useSetDueWithDefaultReminder(), { wrapper })

    result.current(NO_TIME, '2026-08-01', '09:00')

    await waitFor(() => expect(updateEq).toHaveBeenCalled())
    await flush()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('leaves an already-timed task alone (a time change is not a first gain)', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSetDueWithDefaultReminder(), { wrapper })

    result.current(TIMED, '2026-08-01', '12:00')

    await waitFor(() => expect(updateEq).toHaveBeenCalled())
    await flush()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('never seeds when clearing the time or the date', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSetDueWithDefaultReminder(), { wrapper })

    result.current(TIMED, '2026-08-01', null)
    result.current(NO_TIME, null, null)

    await waitFor(() => expect(updateEq).toHaveBeenCalledTimes(2))
    await flush()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('existing reminder rows block the seed (a cleared set must not return)', async () => {
    const { wrapper } = makeWrapper({ reminders: new Map([['t1', [30]]]) })
    const { result } = renderHook(() => useSetDueWithDefaultReminder(), { wrapper })

    result.current(NO_TIME, '2026-08-01', '09:00')

    await waitFor(() => expect(updateEq).toHaveBeenCalled())
    await flush()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('fails toward Off while the schedule config has not loaded', async () => {
    const { wrapper } = makeWrapper({ scheduleLoaded: false })
    const { result } = renderHook(() => useSetDueWithDefaultReminder(), { wrapper })

    result.current(NO_TIME, '2026-08-01', '09:00')

    await waitFor(() => expect(updateEq).toHaveBeenCalled())
    await flush()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('skips the seed when the due write itself fails (and the failure still toasts)', async () => {
    updateEq.mockResolvedValue({ error: { message: 'boom' } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSetDueWithDefaultReminder(), { wrapper })

    result.current(NO_TIME, '2026-08-01', '09:00')

    expect(await screen.findByText("Couldn't save your change — try again.")).toBeInTheDocument()
    await flush()
    expect(rpc).not.toHaveBeenCalled()
  })
})
