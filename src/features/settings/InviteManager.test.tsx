import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

// use-invite imports lib/supabase, which throws at import without env vars (CI has none) — stub it,
// same pattern as use-invite.test.ts. The hooks themselves are stubbed below, but the module's REAL
// range constants are kept (importOriginal), so this test breaks if the form and the request ever
// disagree about the bounds.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const generateMutate = vi.fn()
const { generateState } = vi.hoisted(() => ({
  generateState: {
    current: {} as { isPending: boolean; isError: boolean; error: unknown; data: unknown },
  },
}))

vi.mock('./use-invite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./use-invite')>()
  return {
    ...actual,
    useInvites: () => ({ isLoading: false, data: [] }),
    useRevokeInvite: () => ({ mutate: vi.fn(), isPending: false }),
    useGenerateInvite: () => ({ ...generateState.current, mutate: generateMutate }),
  }
})

import { InviteManager } from './InviteManager'

beforeEach(() => {
  generateMutate.mockClear()
  generateState.current = { isPending: false, isError: false, error: null, data: undefined }
})

const uses = () => screen.getByLabelText('Uses')
const expires = () => screen.getByLabelText('Expires (days)')
const generate = () => screen.getByRole('button', { name: 'Generate link' })

describe('InviteManager number fields', () => {
  it('sends the defaults untouched', () => {
    render(<InviteManager />)
    fireEvent.click(generate())
    expect(generateMutate).toHaveBeenCalledWith({ maxUses: 1, expiresInDays: 7 })
  })

  it('sends what was typed', () => {
    render(<InviteManager />)
    fireEvent.change(expires(), { target: { value: '5' } })
    fireEvent.change(uses(), { target: { value: '3' } })
    fireEvent.click(generate())
    expect(generateMutate).toHaveBeenCalledWith({ maxUses: 3, expiresInDays: 5 })
  })

  // The regression: clearing a field used to report Number('') === 0, below the server's min, so
  // generating from a momentarily-empty box 400'd with an unreadable "non-2xx status code".
  it('generating from a cleared field falls back to the last good value, never 0', () => {
    render(<InviteManager />)
    fireEvent.change(expires(), { target: { value: '' } })
    fireEvent.click(generate())
    expect(generateMutate).toHaveBeenCalledWith({ maxUses: 1, expiresInDays: 7 })
  })

  // Same shape via the other route into a non-number: a partially-typed exponent.
  it('never reports NaN from a half-typed value', () => {
    render(<InviteManager />)
    fireEvent.change(uses(), { target: { value: '3e' } })
    fireEvent.click(generate())
    expect(generateMutate).toHaveBeenCalledWith({ maxUses: 1, expiresInDays: 7 })
  })

  it('restores the box to the committed value on blur', () => {
    render(<InviteManager />)
    fireEvent.change(expires(), { target: { value: '' } })
    expect(expires()).toHaveValue(null) // empty while typing — the parent still holds 7
    fireEvent.blur(expires())
    expect(expires()).toHaveValue(7)
  })

  it('clamps an over-max entry on blur instead of sending it', () => {
    render(<InviteManager />)
    fireEvent.change(uses(), { target: { value: '900' } })
    fireEvent.blur(uses())
    expect(uses()).toHaveValue(50)
    fireEvent.click(generate())
    expect(generateMutate).toHaveBeenCalledWith({ maxUses: 50, expiresInDays: 7 })
  })
})

describe('InviteManager errors', () => {
  it('shows the mapped reason rather than the raw transport message', () => {
    generateState.current = {
      isPending: false,
      isError: true,
      error: new Error('Your session expired. Sign out and back in, then try again.'),
      data: undefined,
    }
    render(<InviteManager />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Couldn’t create an invite. Your session expired. Sign out and back in, then try again.',
    )
  })
})
