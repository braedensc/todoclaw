import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfirmProvider } from '../../components/use-confirm'
import type { Habit } from '../../types/habit'

// Mirrors HabitsView.test's hook mocking so RemindersInline renders under jsdom with no Supabase.
const habitsMock = vi.fn()
const dailyMock = vi.fn()
const updateMutate = vi.fn()
const deleteMutate = vi.fn()
const toggleMutate = vi.fn()

vi.mock('./use-habits', () => ({
  useHabits: () => habitsMock(),
  useUpdateHabit: () => ({ mutate: updateMutate, isPending: false, variables: undefined }),
  useSoftDeleteHabit: () => ({ mutate: deleteMutate, isPending: false, variables: undefined }),
  useToggleDailyFlag: () => ({ mutate: toggleMutate, isPending: false }),
}))
vi.mock('../daily-state/use-daily-state', () => ({
  useDailyState: () => dailyMock(),
}))
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: { timezone: 'America/New_York' } }),
}))

import { RemindersInline } from './RemindersInline'

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    user_id: 'u1',
    text: 'Wrist strengthening routine',
    active: true,
    subtasks: [{ id: 's1', text: 'Rice bucket — 3 sets each direction' }],
    created_at: '2026-06-23T00:00:00.000Z',
    deleted_at: null,
    ...over,
  }
}

function setHabits(habits: Habit[]) {
  habitsMock.mockReturnValue({ data: habits, isLoading: false, isError: false })
}

// The detail modal's delete gates on useConfirm(), so the tree needs a ConfirmProvider (mirrors
// how AppShell mounts it at the root). The provider adds no DOM of its own until a confirm is open.
function renderInline() {
  return render(
    <ConfirmProvider>
      <RemindersInline />
    </ConfirmProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  dailyMock.mockReturnValue({ data: { done: {}, done_at: {}, habit_done: {}, subtask_done: {} } })
})

describe('RemindersInline', () => {
  it('renders nothing when there are no ACTIVE reminders', () => {
    setHabits([habit({ active: false })])
    const { container } = renderInline()
    expect(container).toBeEmptyDOMElement()
  })

  it('lists only active reminder names as clickable links (queued ones are hidden)', () => {
    setHabits([
      habit({ id: 'h1', text: 'Alpha' }),
      habit({ id: 'h2', text: 'Queued', active: false }),
    ])
    renderInline()
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Queued' })).not.toBeInTheDocument()
  })

  it('opens a per-reminder detail modal (steps expanded) when a name is clicked', () => {
    setHabits([habit()])
    renderInline()
    // No dialog until a name is clicked.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Wrist strengthening routine' }))
    const dialog = screen.getByRole('dialog', { name: /Reminder: Wrist strengthening routine/i })
    // defaultExpanded → the step is visible without a further click.
    expect(within(dialog).getByText('Rice bucket — 3 sets each direction')).toBeInTheDocument()
  })

  it('toggles the reminder from inside the detail modal via set_daily_flag', () => {
    setHabits([habit()])
    renderInline()
    fireEvent.click(screen.getByRole('button', { name: 'Wrist strengthening routine' }))
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Mark "Wrist strengthening routine" done today/i }),
    )
    expect(toggleMutate).toHaveBeenCalledWith({
      map: 'habit_done',
      key: 'h1',
      value: true,
      timeZone: 'America/New_York',
    })
  })

  it('closes the detail modal via the ✕ button', () => {
    setHabits([habit()])
    renderInline()
    fireEvent.click(screen.getByRole('button', { name: 'Wrist strengthening routine' }))
    fireEvent.click(screen.getByRole('button', { name: /Close reminder/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('soft-deletes the reminder from the detail modal only after confirming', async () => {
    setHabits([habit()])
    renderInline()
    fireEvent.click(screen.getByRole('button', { name: 'Wrist strengthening routine' }))
    fireEvent.click(
      screen.getByRole('button', { name: /Delete reminder "Wrist strengthening routine"/i }),
    )
    // The themed confirm dialog appears (distinct from the detail modal); deletion fires only
    // after its Delete button is clicked.
    const confirmDialog = await screen.findByRole('dialog', { name: /Delete the reminder/i })
    fireEvent.click(within(confirmDialog).getByRole('button', { name: /^Delete$/ }))
    // RemindersInline passes an onSuccess (to close the modal) as the mutate options arg.
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('h1', expect.anything()))
  })
})
