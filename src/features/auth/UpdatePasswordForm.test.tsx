import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock the Supabase client (src/lib/supabase throws at import without env vars).
// vi.hoisted so the mock fns exist before the hoisted vi.mock factory runs.
const { updateUser, signOut } = vi.hoisted(() => ({
  updateUser: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { updateUser, signOut } },
}))

import { UpdatePasswordForm, MIN_PASSWORD_LENGTH } from './UpdatePasswordForm'

const GOOD = 'a-long-enough-pw'

function fill(password: string, confirm = password) {
  fireEvent.change(
    screen.getByPlaceholderText(`New password (${MIN_PASSWORD_LENGTH}+ characters)`),
    {
      target: { value: password },
    },
  )
  fireEvent.change(screen.getByPlaceholderText('Confirm new password'), {
    target: { value: confirm },
  })
}

describe('UpdatePasswordForm (password recovery landing)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateUser.mockResolvedValue({ error: null })
    signOut.mockResolvedValue({ error: null })
  })

  it('sets the new password and reports done', async () => {
    const onDone = vi.fn()
    render(<UpdatePasswordForm onDone={onDone} />)
    fill(GOOD)
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: GOOD }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('refuses a mismatched confirmation without calling updateUser', async () => {
    const onDone = vi.fn()
    render(<UpdatePasswordForm onDone={onDone} />)
    fill(GOOD, 'something-else-entirely')
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))

    expect(await screen.findByText(/don’t match/)).toBeInTheDocument()
    expect(updateUser).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('refuses a too-short password without calling updateUser', async () => {
    render(<UpdatePasswordForm onDone={vi.fn()} />)
    fill('short')
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))

    expect(await screen.findByText(/at least 8 characters/)).toBeInTheDocument()
    expect(updateUser).not.toHaveBeenCalled()
  })

  // The hosted leaked-password (HIBP) check rejects through this same path, so the message has
  // to reach the user verbatim rather than collapsing into a generic failure.
  it('surfaces the server’s rejection verbatim, and stays put', async () => {
    updateUser.mockResolvedValue({
      error: { message: 'This password has been found in a data breach. Please choose another.' },
    })
    const onDone = vi.fn()
    render(<UpdatePasswordForm onDone={onDone} />)
    fill(GOOD)
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))

    expect(await screen.findByText(/found in a data breach/)).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  // The recovery link already established a session. Backing out must not leave that session
  // usable, or the link becomes a passwordless login that skipped the reset.
  it('signs out when the flow is abandoned', async () => {
    const onDone = vi.fn()
    render(<UpdatePasswordForm onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and sign out' }))

    await waitFor(() => expect(signOut).toHaveBeenCalled())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(updateUser).not.toHaveBeenCalled()
  })
})
