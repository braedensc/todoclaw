import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// The wizard + SafariTroubleshooting reach src/lib/supabase through their module graphs — and
// that module THROWS at import without env vars (CI runs with none). Stub the client module
// itself so every transitive importer is satisfied.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

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
    done: false,
    context: 'ios',
    canPrompt: false,
    promptInstall: vi.fn(),
  },
  notificationsDone: false,
  taskAdded: false,
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

  it('renders the three step titles, the pitch line, and the progress count', () => {
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByRole('region', { name: 'Setup guide' })).toBeInTheDocument()
    expect(screen.getByText('See how Todoclaw works')).toBeInTheDocument()
    expect(
      screen.getByText('Put Todoclaw on your Home Screen & turn on notifications'),
    ).toBeInTheDocument()
    expect(screen.getByText('Add a task, then let Todoclaw plan your day')).toBeInTheDocument()
    expect(screen.getByText(/to-do list on a map/)).toBeInTheDocument()
    expect(screen.getByText('0/3')).toBeInTheDocument()
  })

  it('launches the tour from step 1', () => {
    const onStartTour = vi.fn()
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} onStartTour={onStartTour} />)
    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }))
    expect(onStartTour).toHaveBeenCalledOnce()
  })

  it('in a browser tab, step 2 offers the wizard — not a bare notifications button', () => {
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} />)
    expect(screen.queryByRole('button', { name: /Turn on notifications/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set it up' }))
    // The iOS walkthrough names the real buttons to tap.
    expect(screen.getByText(/“Add to Home Screen”/)).toBeInTheDocument()
  })

  it('inside the installed app, step 2 turns notifications on right on the card', () => {
    mockEnable.mockResolvedValue(true)
    mockGuide.mockReturnValue(baseState({ install: { ...baseState().install, done: true } }))
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByText(/You’re in the app ✓/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Turn on notifications/ }))
    expect(mockEnable).toHaveBeenCalledOnce()
  })

  it('with no install gesture (unknown context), step 2 is just the notifications button', () => {
    mockEnable.mockResolvedValue(true)
    mockGuide.mockReturnValue(
      baseState({ install: { ...baseState().install, context: 'unknown' } }),
    )
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByText('Turn on daily notifications')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set it up' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Turn on notifications/ }))
    expect(mockEnable).toHaveBeenCalledOnce()
  })

  it('surfaces the enabler’s error inline (installed card state)', () => {
    mockNotif.mockReturnValue({
      enable: mockEnable,
      busy: false,
      error: 'Notifications are blocked in your browser settings.',
      setupFailed: false,
      supported: true,
    })
    mockGuide.mockReturnValue(baseState({ install: { ...baseState().install, done: true } }))
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByText(/blocked in your browser/)).toBeInTheDocument()
  })

  it('step 3 evolves: Show me where → Plan my day once a task exists', () => {
    const onShowAddTask = vi.fn()
    const onPlan = vi.fn()
    mockGuide.mockReturnValue(baseState())
    const { rerender } = render(
      <SetupGuide {...noopProps} onShowAddTask={onShowAddTask} onPlan={onPlan} />,
    )
    expect(screen.queryByRole('button', { name: /Plan my day/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show me where' }))
    expect(onShowAddTask).toHaveBeenCalledOnce()

    mockGuide.mockReturnValue(baseState({ taskAdded: true }))
    rerender(<SetupGuide {...noopProps} onShowAddTask={onShowAddTask} onPlan={onPlan} />)
    expect(screen.queryByRole('button', { name: 'Show me where' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Plan my day' }))
    expect(onPlan).toHaveBeenCalledOnce()

    mockGuide.mockReturnValue(baseState({ taskAdded: true }))
    rerender(<SetupGuide {...noopProps} onPlan={onPlan} planPending />)
    expect(screen.getByRole('button', { name: 'Planning…' })).toBeDisabled()
  })

  it('collapses finished steps and celebrates when everything is done', () => {
    const dismiss = vi.fn()
    mockGuide.mockReturnValue(
      baseState({
        tourDone: true,
        notificationsDone: true,
        taskAdded: true,
        planDone: true,
        doneCount: 3,
        allDone: true,
        dismiss,
      }),
    )
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByText('You’re all set!')).toBeInTheDocument()
    // Finished steps drop their hints/actions.
    expect(screen.queryByRole('button', { name: 'Take the tour' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set it up' })).not.toBeInTheDocument()
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
