import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Mock the state hook wholesale — the component test only cares about rendering each state; the
// detection/persistence logic has its own suite (use-setup-guide.test.tsx).
import type { SetupGuideState } from './use-setup-guide'
const mockGuide = vi.fn<() => SetupGuideState>()
vi.mock('./use-setup-guide', () => ({
  useSetupGuide: () => mockGuide(),
}))

import { SetupGuide } from './SetupGuide'

const baseState = (over: Partial<SetupGuideState> = {}): SetupGuideState => ({
  visible: true,
  install: {
    shown: true,
    done: false,
    context: 'ios',
    canPrompt: false,
    promptInstall: vi.fn(),
  },
  notificationsDone: false,
  planDone: false,
  doneCount: 0,
  stepCount: 3,
  allDone: false,
  dismiss: vi.fn(),
  ...over,
})

const noopProps = {
  planReady: false,
  planPending: false,
  canPlan: true,
  onPlan: vi.fn(),
  onOpenNotificationSettings: vi.fn(),
}

describe('SetupGuide', () => {
  it('renders nothing when not visible', () => {
    mockGuide.mockReturnValue(baseState({ visible: false }))
    const { container } = render(<SetupGuide {...noopProps} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the three step titles and the progress count', () => {
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByRole('region', { name: 'Setup guide' })).toBeInTheDocument()
    expect(screen.getByText('Install Todoclaw as an app')).toBeInTheDocument()
    expect(screen.getByText('Turn on daily notifications')).toBeInTheDocument()
    expect(screen.getByText('Try Plan My Day')).toBeInTheDocument()
    expect(screen.getByText('0/3')).toBeInTheDocument()
  })

  it('on iOS before install, gates the notifications step instead of offering the button', () => {
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} />)
    // The iOS install gesture is shown, and step 2 points back at it.
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).not.toBeInTheDocument()
    expect(screen.getByText(/Install the app first/)).toBeInTheDocument()
  })

  it('opens the notifications settings once installable contexts allow it', () => {
    const onOpen = vi.fn()
    mockGuide.mockReturnValue(
      baseState({ install: { ...baseState().install, context: 'macos-safari' } }),
    )
    render(<SetupGuide {...noopProps} onOpenNotificationSettings={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn on notifications' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('offers a native install button when Chromium handed us the deferred prompt', () => {
    const promptInstall = vi.fn()
    mockGuide.mockReturnValue(
      baseState({
        install: { shown: true, done: false, context: 'chromium', canPrompt: true, promptInstall },
      }),
    )
    render(<SetupGuide {...noopProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Install app' }))
    expect(promptInstall).toHaveBeenCalledOnce()
  })

  it('fires plan generation and disables while pending', () => {
    const onPlan = vi.fn()
    mockGuide.mockReturnValue(
      baseState({ install: { ...baseState().install, context: 'macos-safari' } }),
    )
    const { rerender } = render(<SetupGuide {...noopProps} onPlan={onPlan} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate today’s plan' }))
    expect(onPlan).toHaveBeenCalledOnce()

    rerender(<SetupGuide {...noopProps} onPlan={onPlan} planPending />)
    expect(screen.getByRole('button', { name: 'Planning…' })).toBeDisabled()
  })

  it('collapses finished steps and celebrates when everything is done', () => {
    const dismiss = vi.fn()
    mockGuide.mockReturnValue(
      baseState({
        install: { ...baseState().install, done: true },
        notificationsDone: true,
        planDone: true,
        doneCount: 3,
        allDone: true,
        dismiss,
      }),
    )
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByText('You’re all set!')).toBeInTheDocument()
    // Finished steps drop their hints/actions.
    expect(screen.queryByText(/Add to Home Screen/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('the ✕ dismisses', () => {
    const dismiss = vi.fn()
    mockGuide.mockReturnValue(baseState({ dismiss }))
    render(<SetupGuide {...noopProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss setup guide' }))
    expect(dismiss).toHaveBeenCalledOnce()
  })
})
