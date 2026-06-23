import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as Sentry from '@sentry/react'
import { ErrorBoundary } from './ErrorBoundary'

// Spy on Sentry so we can assert the crash is reported without needing a DSN.
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

function Boom(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('shows the fallback and reports to Sentry when a child throws', () => {
    // React logs the caught error to console.error; silence it for a clean test run.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(Sentry.captureException).toHaveBeenCalledOnce()

    errorSpy.mockRestore()
  })
})
