import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
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

beforeEach(() => {
  vi.clearAllMocks()
  dailyMock.mockReturnValue({ data: { done: {}, done_at: {}, habit_done: {}, subtask_done: {} } })
})

describe('RemindersInline', () => {
  it('renders nothing when there are no ACTIVE reminders', () => {
    setHabits([habit({ active: false })])
    const { container } = render(<RemindersInline />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists only active reminder names as clickable links (queued ones are hidden)', () => {
    setHabits([
      habit({ id: 'h1', text: 'Alpha' }),
      habit({ id: 'h2', text: 'Queued', active: false }),
    ])
    render(<RemindersInline />)
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Queued' })).not.toBeInTheDocument()
  })

  it('opens a per-reminder detail modal (steps expanded) when a name is clicked', () => {
    setHabits([habit()])
    render(<RemindersInline />)
    // No dialog until a name is clicked.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Wrist strengthening routine' }))
    const dialog = screen.getByRole('dialog', { name: /Reminder: Wrist strengthening routine/i })
    // defaultExpanded → the step is visible without a further click.
    expect(within(dialog).getByText('Rice bucket — 3 sets each direction')).toBeInTheDocument()
  })

  it('toggles the reminder from inside the detail modal via set_daily_flag', () => {
    setHabits([habit()])
    render(<RemindersInline />)
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
    render(<RemindersInline />)
    fireEvent.click(screen.getByRole('button', { name: 'Wrist strengthening routine' }))
    fireEvent.click(screen.getByRole('button', { name: /Close reminder/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
