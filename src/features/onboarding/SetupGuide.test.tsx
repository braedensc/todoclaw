import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// The wizard + SafariTroubleshooting reach src/lib/supabase through their module graphs — and
// that module THROWS at import without env vars (CI runs with none). Stub the client module
// itself so every transitive importer is satisfied.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

// Mock the state hook wholesale — the component test only cares about rendering each state; the
// detection/persistence logic has its own suite (use-setup-guide.test.tsx). Same for the
// one-click notifications enabler (its own suite: use-enable-notifications.test.tsx).
import type { InstallContext, SetupGuideState, SetupStepKey } from './use-setup-guide'
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

// The dismiss ✕ gates through useConfirm() now — mock it to a spy we can inspect + resolve.
const mockConfirm = vi.fn<(o: unknown) => Promise<boolean>>()
vi.mock('../../components/use-confirm', () => ({
  useConfirm: () => mockConfirm,
}))

import { SetupGuide } from './SetupGuide'

// Mirror the hook's platform-adaptive ordering so the mocked state stays self-consistent.
function stepOrderFor(context: InstallContext): SetupStepKey[] {
  if (context === 'unknown') return ['tour', 'notifications', 'plan']
  if (context === 'ios' || context === 'macos-safari')
    return ['tour', 'install', 'notifications', 'plan']
  return ['tour', 'notifications', 'install', 'plan']
}

const baseState = (over: Partial<SetupGuideState> = {}): SetupGuideState => {
  const install = {
    done: false,
    context: 'ios' as InstallContext,
    canPrompt: false,
    promptInstall: vi.fn(),
    ...over.install,
  }
  const tourDone = over.tourDone ?? false
  const notificationsDone = over.notificationsDone ?? false
  const planDone = over.planDone ?? false
  const order = stepOrderFor(install.context)
  const done: Record<SetupStepKey, boolean> = {
    tour: tourDone,
    install: install.done,
    notifications: notificationsDone,
    plan: planDone,
  }
  const activeDone = order.map((k) => done[k])
  const isApple = install.context === 'ios' || install.context === 'macos-safari'
  return {
    visible: true,
    order,
    done,
    tourDone,
    install,
    notificationsDone,
    canEnableNotificationsHere: !isApple || install.done,
    taskAdded: false,
    planDone,
    doneCount: activeDone.filter(Boolean).length,
    stepCount: order.length,
    allDone: activeDone.every(Boolean),
    dismiss: vi.fn(),
    ...over,
  }
}

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
  mockConfirm.mockReset()
  mockConfirm.mockResolvedValue(true)
})

describe('SetupGuide', () => {
  it('renders nothing when not visible', () => {
    mockGuide.mockReturnValue(baseState({ visible: false }))
    const { container } = render(<SetupGuide {...noopProps} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the four step titles (iOS), the pitch line, and the progress count', () => {
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByRole('region', { name: 'Setup guide' })).toBeInTheDocument()
    expect(screen.getByText('See how Todoclaw works')).toBeInTheDocument()
    // Install + notifications are now SEPARATE, separately-titled steps.
    expect(screen.getByText('Add Todoclaw to your Home Screen')).toBeInTheDocument()
    expect(screen.getByText('Turn on daily notifications')).toBeInTheDocument()
    expect(screen.getByText('Add a task, then let Todoclaw plan your day')).toBeInTheDocument()
    expect(screen.getByText(/to-do list on a map/)).toBeInTheDocument()
    expect(screen.getByText('0/4')).toBeInTheDocument()
  })

  it('launches the tour from step 1', () => {
    const onStartTour = vi.fn()
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} onStartTour={onStartTour} />)
    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }))
    expect(onStartTour).toHaveBeenCalledOnce()
  })

  it('iOS browser tab: the install step opens the walkthrough; notifications wait for the app', () => {
    mockGuide.mockReturnValue(baseState())
    render(<SetupGuide {...noopProps} />)
    // Notifications can't be enabled from an iOS tab — no button, it points at the install step.
    expect(screen.queryByRole('button', { name: /Turn on notifications/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Add Todoclaw to your Home Screen first/)).toBeInTheDocument()
    // The install step's own button opens the drawn walkthrough.
    fireEvent.click(screen.getByRole('button', { name: 'Show me how' }))
    expect(screen.getByText(/“Add to Home Screen”/)).toBeInTheDocument()
  })

  it('inside the installed app, the notifications step turns them on right on the card', () => {
    mockEnable.mockResolvedValue(true)
    mockGuide.mockReturnValue(baseState({ install: { ...baseState().install, done: true } }))
    render(<SetupGuide {...noopProps} />)
    // Install step is done → collapsed (no "Show me how"); notifications now enable in place.
    expect(screen.queryByRole('button', { name: 'Show me how' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Turn on notifications/ }))
    expect(mockEnable).toHaveBeenCalledOnce()
  })

  it('with no install gesture (unknown context), there is no install step — just notifications', () => {
    mockEnable.mockResolvedValue(true)
    mockGuide.mockReturnValue(
      baseState({ install: { ...baseState().install, context: 'unknown' } }),
    )
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByText('Turn on daily notifications')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show me how' })).not.toBeInTheDocument()
    expect(screen.getByText('0/3')).toBeInTheDocument()
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

  it('plan step evolves: Show me where → Plan my day once a task exists', () => {
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
        install: { done: true, context: 'ios', canPrompt: false, promptInstall: vi.fn() },
        notificationsDone: true,
        taskAdded: true,
        planDone: true,
        dismiss,
      }),
    )
    render(<SetupGuide {...noopProps} />)
    expect(screen.getByText('You’re all set!')).toBeInTheDocument()
    // Finished steps drop their hints/actions.
    expect(screen.queryByRole('button', { name: 'Take the tour' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show me how' })).not.toBeInTheDocument()
    // The finished card closes straight away — no confirm gate.
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(dismiss).toHaveBeenCalledOnce()
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('the ✕ confirms before removing an unfinished guide', async () => {
    const dismiss = vi.fn()
    mockGuide.mockReturnValue(baseState({ dismiss }))
    render(<SetupGuide {...noopProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove setup guide' }))
    expect(mockConfirm).toHaveBeenCalledOnce()
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Remove the setup guide?' }),
    )
    await waitFor(() => expect(dismiss).toHaveBeenCalledOnce())
  })

  it('the ✕ leaves the guide alone when the confirm is declined', async () => {
    const dismiss = vi.fn()
    mockConfirm.mockResolvedValue(false)
    mockGuide.mockReturnValue(baseState({ dismiss }))
    render(<SetupGuide {...noopProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove setup guide' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledOnce())
    expect(dismiss).not.toHaveBeenCalled()
  })
})
