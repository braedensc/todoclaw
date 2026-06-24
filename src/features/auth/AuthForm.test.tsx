import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock the Supabase client (src/lib/supabase throws at import without env vars).
// vi.hoisted so the mock fns exist before the hoisted vi.mock factory runs.
const { signInWithPassword, signUp } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithPassword, signUp } },
}))

import { AuthForm } from './AuthForm'

describe('AuthForm (invite-only, sign-in only)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signInWithPassword.mockResolvedValue({ error: null })
  })

  it('offers sign-in only — no account-creation affordance', () => {
    render(<AuthForm />)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    // No sign-up toggle or button of any kind.
    expect(screen.queryByText(/sign up/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/create account/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/need an account/i)).not.toBeInTheDocument()
    expect(screen.getByText(/invite-only/i)).toBeInTheDocument()
  })

  it('calls signInWithPassword on submit and never signUp', async () => {
    render(<AuthForm />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'braeden@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'hunter2!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'braeden@example.com',
        password: 'hunter2!',
      }),
    )
    expect(signUp).not.toHaveBeenCalled()
  })

  it('surfaces a sign-in error', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    render(<AuthForm />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'x@y.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrongpw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument()
  })
})
