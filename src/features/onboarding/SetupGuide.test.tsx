import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the state hook wholesale — the component test only cares about rendering each state; the
// detection/persistence logic has its own suite (use-setup-guide.test.tsx). Same for the
// one-click notifications enabler (its own suite: use-enable-notifications.test.tsx).
import type { SetupGuideState } from './use-setup-guide'
const mockGuide = vi.fn<() => SetupGuideState>()
vi.mock('./use-setup-guide', () => ({
  useSetupGuide: () => mockGuide(),
}))

const mockEnable = vi.fn<() => Promise<boolean>>()
const mockNotif = vi.fn(() => ({
  enable: mockEnable,
  busy: false,
  error: null as string | null,
  setupFailed: false,
  supported: true,
}))
vi.mock('../notifications/use-enable-notifications', () => ({
  useEnableNotifications: () => mockNotif(),
}))

import { SetupGuide } from './SetupGuide'

const baseState = (over: Partial<SetupGuideState> = {}): SetupGuideState => ({
  visible: true,
  tourDone: false,
  install: {
    shown: true,
    done: false,
    context: 'ios',
    canPrompt: false,
    promptInstall: vi.fn(),
  },
  notificationsDone: false,
  taskAdded: false,
  planDone: false,
  doneCount: 0,
  stepCount: 5,
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
  onStartTour: vi.fn(),
  onShowAddTask: vi.fn(),
}

beforeEach(() => {
  mockEnable.mockReset()
  mockNotif.mockClear()
})

describe('SetupGuide', () => {
  it('renders nothing when not visible', () => {
    mockGuide.mockReturnValue(baseState({ visible: false }))
    const { container } = render(<SetupGuide {...noopProps} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the five step titles, the pitch line, and the progress count', () => {
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByRole('region', { name: 'Setup guide' })).toBeInTheDocument()
    expect(screen.getByText('See how Todoclaw works')).toBeInTheDocument()
    expect(screen.getByText('Add Todoclaw to your Home Screen')).toBeInTheDocument()
    expect(screen.getByText('Turn on daily notifications')).toBeInTheDocument()
    expect(screen.getByText('Add your first task')).toBeInTheDocument()
    expect(screen.getByText('Try Plan My Day')).toBeInTheDocument()
    expect(screen.getByText(/to-do list on a map/)).toBeInTheDocument()
    expect(screen.getByText('0/5')).toBeInTheDocument()
  })

  it('launches the tour from step 1', () => {
    const onStartTour = vi.fn()
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} onStartTour={onStartTour} />)
    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }))
    expect(onStartTour).toHaveBeenCalledOnce()
  })

  it('"Show me how" opens the illustrated install walkthrough', () => {
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show me how' }))
    // The iOS walkthrough names the real buttons to tap.
    expect(screen.getByText(/“Add to Home Screen”/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByText(/“Add to Home Screen”/)).not.toBeInTheDocument()
  })

  it('on iOS before install, gates the notifications step behind the Home-Screen add', () => {
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} />)
    expect(screen.queryByRole('button', { name: /Turn on notifications/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Home Screen first/)).toBeInTheDocument()
  })

  it('the notifications button enables in place once the context allows it', () => {
    mockEnable.mockResolvedValue(true)
    mockGuide.mockReturnValue(
      baseState({ install: { ...baseState().install, context: 'macos-safari' } }),
    )
    render(<SetupGuide {...noopProps} />)
    fireEvent.click(screen.getByRole('button', { name: /Turn on notifications/ }))
    expect(mockEnable).toHaveBeenCalledOnce()
  })

  it('surfaces the enabler’s error inline', () => {
    mockNotif.mockReturnValue({
      enable: mockEnable,
      busy: false,
      error: 'Notifications are blocked in your browser settings.',
      setupFailed: false,
      supported: true,
    })
    mockGuide.mockReturnValue(
      baseState({ install: { ...baseState().install, context: 'macos-safari' } }),
    )
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByText(/blocked in your browser/)).toBeInTheDocument()
  })

  it('offers a native install button when Chromium handed us the deferred prompt', () => {
    const promptInstall = vi.fn()
    mockGuide.mockReturnValue(
      baseState({
        install: { shown: true, done: false, context: 'chromium', canPrompt: true, promptInstall },
      }),
    )
    render(<SetupGuide {...noopProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Install now' }))
    expect(promptInstall).toHaveBeenCalledOnce()
  })

  it('the first-task step points at the capture surface', () => {
    const onShowAddTask = vi.fn()
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} onShowAddTask={onShowAddTask} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show me where' }))
    expect(onShowAddTask).toHaveBeenCalledOnce()
  })

  it('holds the Plan step behind the first task, then fires plan generation', () => {
    const onPlan = vi.fn()
    mockGuide.mockReturnValue(baseState())
    const { rerender } = render(<SetupGuide {...noopProps} onPlan={onPlan} />)
    // No task yet → no plan button, a pointer back to the add step instead.
    expect(screen.queryByRole('button', { name: /Generate today’s plan/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Add a task first/)).toBeInTheDocument()

    mockGuide.mockReturnValue(baseState({ taskAdded: true, doneCount: 1 }))
    rerender(<SetupGuide {...noopProps} onPlan={onPlan} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate today’s plan' }))
    expect(onPlan).toHaveBeenCalledOnce()

    mockGuide.mockReturnValue(baseState({ taskAdded: true, doneCount: 1 }))
    rerender(<SetupGuide {...noopProps} onPlan={onPlan} planPending />)
    expect(screen.getByRole('button', { name: 'Planning…' })).toBeDisabled()
  })

  it('collapses finished steps and celebrates when everything is done', () => {
    const dismiss = vi.fn()
    mockGuide.mockReturnValue(
      baseState({
        tourDone: true,
        install: { ...baseState().install, done: true },
        notificationsDone: true,
        taskAdded: true,
        planDone: true,
        doneCount: 5,
        allDone: true,
        dismiss,
      }),
    )
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByText('You’re all set!')).toBeInTheDocument()
    // Finished steps drop their hints/actions.
    expect(screen.queryByRole('button', { name: 'Take the tour' })).not.toBeInTheDocument()
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
