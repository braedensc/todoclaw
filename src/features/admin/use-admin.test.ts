import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

// Mock the supabase client (it throws at import without env, and we want to assert the invoke call).
// vi.hoisted so `invoke` exists when the hoisted vi.mock factory runs.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke } } }))

import { useAdminOverview, formatUsd, type AdminOverview } from './use-admin'

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

describe('formatUsd', () => {
  it('formats micro-dollars as $X.XX', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(20_000_000)).toBe('$20.00')
    expect(formatUsd(8_000_000)).toBe('$8.00')
    expect(formatUsd(13_500)).toBe('$0.01')
  })
})

describe('useAdminOverview', () => {
  beforeEach(() => invoke.mockReset())

  it('invokes the admin function with { action: get_overview } and returns the data', async () => {
    const overview: AdminOverview = {
      config: null,
      globalSpend: null,
      roster: [],
      systemStats: null,
      integrations: {},
    }
    invoke.mockResolvedValue({ data: overview, error: null })

    const { result } = renderHook(() => useAdminOverview(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invoke).toHaveBeenCalledWith('admin', { body: { action: 'get_overview' } })
    expect(result.current.data).toEqual(overview)
  })

  it('surfaces an error when the function returns one (e.g. a 403 for a non-owner)', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('forbidden') })

    const { result } = renderHook(() => useAdminOverview(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
