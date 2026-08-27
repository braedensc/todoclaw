import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock the Supabase client (src/lib/supabase throws at import without env vars).
// vi.hoisted so the mock fns exist before the hoisted vi.mock factory runs.
const { signInWithPassword, signUp, resetPasswordForEmail } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithPassword, signUp, resetPasswordForEmail } },
}))

import { AuthForm } from './AuthForm'

describe('AuthForm (invite-only, sign-in only)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signInWithPassword.mockResolvedValue({ error: null })
    resetPasswordForEmail.mockResolvedValue({ error: null })
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
  describe('forgot password', () => {
    function requestReset(address: string) {
      fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
        target: { value: address },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    }

    it('mails a reset link for the address in the email field', async () => {
      render(<AuthForm />)
      requestReset('braeden@example.com')

      await waitFor(() =>
        expect(resetPasswordForEmail).toHaveBeenCalledWith('braeden@example.com', {
          redirectTo: window.location.origin,
        }),
      )
      expect(signInWithPassword).not.toHaveBeenCalled()
    })

    // The whole point of the neutral copy: a reset form that distinguishes the two is an
    // account-existence oracle. GoTrue answers 200 either way, so our side must not branch.
    it('says exactly the same thing for a registered and an unregistered address', async () => {
      const { unmount } = render(<AuthForm />)
      requestReset('known@example.com')
      const known = (await screen.findByText(/reset link is on its way/)).textContent
      unmount()

      render(<AuthForm />)
      requestReset('nobody@example.com')
      const unknown = (await screen.findByText(/reset link is on its way/)).textContent

      expect(unknown).toBe(known)
    })

    it('asks for an email address instead of sending an empty request', async () => {
      render(<AuthForm />)
      fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))

      expect(await screen.findByText(/Enter your email address first/)).toBeInTheDocument()
      expect(resetPasswordForEmail).not.toHaveBeenCalled()
    })

    // A rate-limit or malformed-address error is not an existence signal, so it is shown.
    it('surfaces a non-enumerating server error', async () => {
      resetPasswordForEmail.mockResolvedValue({
        error: { message: 'For security purposes, you can only request this after 51 seconds.' },
      })
      render(<AuthForm />)
      requestReset('braeden@example.com')

      expect(await screen.findByText(/after 51 seconds/)).toBeInTheDocument()
      expect(screen.queryByText(/reset link is on its way/)).not.toBeInTheDocument()
    })
  })
})
