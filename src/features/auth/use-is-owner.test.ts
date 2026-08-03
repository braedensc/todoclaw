import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

// Mock the supabase client (it throws at import without env) and the session hook, so we can drive
// the `whoami` response and the signed-in state independently. vi.hoisted so both exist when the
// hoisted vi.mock factories run.
const { invoke, sessionRef } = vi.hoisted(() => ({
  invoke: vi.fn(),
  sessionRef: { current: null as { user: { id: string } } | null },
}))
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke } } }))
vi.mock('./use-session', () => ({
  useSession: () => ({ session: sessionRef.current, loading: false }),
}))

import { useIsOwner } from './use-is-owner'

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

describe('useIsOwner', () => {
  beforeEach(() => {
    invoke.mockReset()
    sessionRef.current = null
  })

  it('does not ask the server when there is no session, and stays false', () => {
    const { result } = renderHook(() => useIsOwner(), { wrapper: makeWrapper() })
    expect(result.current).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reveals the owner (true) only when the server says isOwner, via the whoami action', async () => {
    sessionRef.current = { user: { id: 'owner-1' } }
    invoke.mockResolvedValue({ data: { isOwner: true }, error: null })

    const { result } = renderHook(() => useIsOwner(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current).toBe(true))
    expect(invoke).toHaveBeenCalledWith('admin', { body: { action: 'whoami' } })
  })

  it('stays false for a signed-in non-owner (server returns isOwner: false)', async () => {
    sessionRef.current = { user: { id: 'someone-else' } }
    invoke.mockResolvedValue({ data: { isOwner: false }, error: null })

    const { result } = renderHook(() => useIsOwner(), { wrapper: makeWrapper() })
    await waitFor(() => expect(invoke).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })

  it('fails closed (false) when the whoami request errors', async () => {
    sessionRef.current = { user: { id: 'owner-1' } }
    invoke.mockResolvedValue({ data: null, error: new Error('network') })

    const { result } = renderHook(() => useIsOwner(), { wrapper: makeWrapper() })
    await waitFor(() => expect(invoke).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })
})
