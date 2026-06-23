import { Component, type ErrorInfo, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'

// Formalizes EisenClaw's inline error boundary (planning/EISENCLAW-LOGIC-TO-PORT.md §13).
// Wrap major UI regions so one component's crash can't white-screen the whole app, and
// report the crash to Sentry (a no-op when no DSN is configured — see src/main.tsx).

interface Props {
  children: ReactNode
  /** Optional custom fallback; defaults to the inline alert + retry below. */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Reports when a DSN is set; otherwise Sentry isn't initialized and this is a no-op.
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } })
  }

  private readonly handleReset = (): void => {
    this.setState({ hasError: false })
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback

    return (
      <div role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm">
        <p className="font-medium text-red-700">Something went wrong.</p>
        <p className="mt-1 text-red-600">
          This part of the app hit an unexpected error. You can try again.
        </p>
        <button
          onClick={this.handleReset}
          className="mt-3 rounded bg-red-600 px-3 py-1.5 text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    )
  }
}
