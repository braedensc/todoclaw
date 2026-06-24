import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Mock the Supabase client; the real Edge Function behaviour (CORS/JWT/guardrails) is proven
// by the function integration test + the psql/deno proofs, not here. This asserts the hook
// invokes the right function and surfaces its data/errors.
const invoke = vi.fn<(name: string) => unknown>()
vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: (name: string) => invoke(name) } },
}))

import { useAiStatus, type AiStatus } from './use-ai-status'

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const STATUS: AiStatus = {
  paused: false,
  budgetRemainingMicros: 20_000_000,
  limits: { chat: { hour: 30, day: 100 }, plan_my_day: { hour: 10, day: 10 } },
  used: { chat: { hour: 0, day: 0 }, plan_my_day: { hour: 0, day: 0 } },
}

beforeEach(() => vi.clearAllMocks())

describe('useAiStatus', () => {
  it('invokes the ai-status function and returns the status', async () => {
    invoke.mockResolvedValue({ data: STATUS, error: null })
    const { result } = renderHook(() => useAiStatus(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invoke).toHaveBeenCalledWith('ai-status')
    expect(result.current.data).toEqual(STATUS)
  })

  it('errors when the function returns an error', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'paused' } })
    const { result } = renderHook(() => useAiStatus(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
