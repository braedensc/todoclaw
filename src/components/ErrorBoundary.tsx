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

    // Theme tokens only (TOD-139): `danger` over a 10% `danger` wash reads in both modes.
    return (
      <div role="alert" className="rounded border border-danger/30 bg-danger/10 p-4 text-sm">
        <p className="font-medium text-danger">Something went wrong.</p>
        <p className="mt-1 text-ink">
          This part of the app hit an unexpected error. You can try again.
        </p>
        <button
          onClick={this.handleReset}
          className="mt-3 rounded bg-danger px-3 py-1.5 text-on-accent hover:opacity-90"
        >
          Try again
        </button>
      </div>
    )
  }
}
