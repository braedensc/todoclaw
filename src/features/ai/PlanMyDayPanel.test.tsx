import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { DayPlan } from './use-plan-my-day'

// Stub the data hooks (no network) and the AI hooks we control per test.
vi.mock('../tasks/use-tasks', () => ({ useTasks: () => ({ data: [], isLoading: false }) }))
vi.mock('../habits/use-habits', () => ({ useHabits: () => ({ data: [], isLoading: false }) }))
vi.mock('../daily-state/use-daily-state', () => ({
  useDailyState: () => ({ data: { done: {} }, isLoading: false }),
}))
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: { timezone: 'America/New_York' } }),
}))

const statusMock = vi.fn()
vi.mock('./use-ai-status', () => ({ useAiStatus: () => statusMock() }))

const mutate = vi.fn()
const planMock = vi.fn()
vi.mock('./use-plan-my-day', () => ({
  usePlanMyDay: () => planMock(),
  buildPlanRequest: () => ({
    today: 'x',
    dayOfWeek: 'Mon',
    tasks: [],
    recurringDue: [],
    habits: [],
  }),
}))

import { PlanMyDayPanel } from './PlanMyDayPanel'

const PLAN: DayPlan = {
  headline: 'A focused but gentle day.',
  availableTime: '~4.5h — lunch + evening',
  bigRock: { task: 'File taxes', why: 'Due tomorrow.', duration: '~1.5h', when: 'afternoon' },
  smallRocks: [{ task: 'Email landlord', why: 'Quick.', duration: '~10min', when: 'evening' }],
  habitNote: 'Nice work keeping the streak.',
}

beforeEach(() => {
  vi.clearAllMocks()
  statusMock.mockReturnValue({ data: { paused: false } })
  planMock.mockReturnValue({ mutate, isPending: false, isError: false, data: null })
})

describe('PlanMyDayPanel', () => {
  it('auto-generates on open and renders the structured plan', () => {
    planMock.mockReturnValue({ mutate, isPending: false, isError: false, data: PLAN })
    render(<PlanMyDayPanel onClose={vi.fn()} />)

    expect(mutate).toHaveBeenCalledTimes(1) // auto-generate fired
    expect(screen.getByText('A focused but gentle day.')).toBeInTheDocument()
    expect(screen.getByText('File taxes')).toBeInTheDocument()
    expect(screen.getByText('Big rock')).toBeInTheDocument()
    expect(screen.getByText('Email landlord')).toBeInTheDocument()
    expect(screen.getByText('Nice work keeping the streak.')).toBeInTheDocument()
  })

  it('shows the paused notice and does NOT call the model when AI is paused', () => {
    statusMock.mockReturnValue({ data: { paused: true } })
    render(<PlanMyDayPanel onClose={vi.fn()} />)

    expect(screen.getByText(/AI is paused for this month/i)).toBeInTheDocument()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('shows a loading state while planning', () => {
    planMock.mockReturnValue({ mutate, isPending: true, isError: false, data: null })
    render(<PlanMyDayPanel onClose={vi.fn()} />)
    expect(screen.getByText(/Planning your day/i)).toBeInTheDocument()
  })
})
