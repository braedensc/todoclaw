import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { localDateInTZ } from '../../lib/dates'
import type { DailyStateMaps } from '../daily-state/use-daily-state'

// Hook-level test for useToggleDailyFlag's OPTIMISTIC update (the checkbox-flicker fix, item 22).
// We seed today's daily_state cache, mutate, and assert the cache flips BEFORE the RPC settles,
// then reconciles on success / rolls back on error. supabase.rpc is the only call exercised.
const rpc = vi.fn<(name: string, args: unknown) => unknown>()
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: (name: string, args: unknown) => rpc(name, args) },
}))

import { useToggleDailyFlag } from './use-habits'

const TZ = 'America/New_York'
const KEY = ['daily_state', localDateInTZ(TZ)] as const

const maps = (over: Partial<DailyStateMaps> = {}): DailyStateMaps => ({
  done: {},
  done_at: {},
  habit_done: {},
  subtask_done: {},
  plan: null,
  ...over,
})

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useToggleDailyFlag(), { wrapper })
  const read = () => qc.getQueryData<DailyStateMaps>(KEY)!
  return { qc, result, read }
}

describe('useToggleDailyFlag (optimistic)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flips the cached checkbox immediately, while the RPC is still in flight, then reconciles', async () => {
    const { qc, result, read } = setup()
    qc.setQueryData<DailyStateMaps>(KEY, maps({ habit_done: { h1: false } }))

    // Hold the RPC open so the mutation stays PENDING across the assertion.
    let release!: () => void
    rpc.mockReturnValue(new Promise((res) => (release = () => res({ error: null }))))

    result.current.mutate({ map: 'habit_done', key: 'h1', value: true, timeZone: TZ })

    // Optimistic: the cache reflects the new value before the mutation settles.
    await waitFor(() => expect(read().habit_done.h1).toBe(true))
    expect(result.current.isPending).toBe(true)

    release()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(read().habit_done.h1).toBe(true)
  })

  it('optimistically flips a subtask (composite key) too', async () => {
    const { qc, result, read } = setup()
    qc.setQueryData<DailyStateMaps>(KEY, maps())
    rpc.mockResolvedValue({ error: null })

    result.current.mutate({ map: 'subtask_done', key: 'h1:s1', value: true, timeZone: TZ })

    await waitFor(() => expect(read().subtask_done['h1:s1']).toBe(true))
  })

  it('rolls the checkbox back to the snapshot when the RPC errors', async () => {
    const { qc, result, read } = setup()
    qc.setQueryData<DailyStateMaps>(KEY, maps({ habit_done: { h1: false } }))
    rpc.mockResolvedValue({ error: { message: 'boom' } })

    result.current.mutate({ map: 'habit_done', key: 'h1', value: true, timeZone: TZ })

    await waitFor(() => expect(result.current.isError).toBe(true))
    // Rolled back to the pre-toggle value — no stuck optimistic checkbox.
    expect(read().habit_done.h1).toBe(false)
  })
})
