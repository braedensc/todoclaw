import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlanBox } from './PlanBox'
import type { DayPlan } from '../../types/plan'

const PLAN: DayPlan = {
  headline: 'A focused but gentle day.',
  availableTime: '~4.5h — lunch + evening',
  bigRock: { task: 'File taxes', why: 'Due tomorrow.', duration: '~1.5h', when: 'afternoon' },
  smallRocks: [
    { task: 'Email landlord', why: 'Quick.', duration: '~10min', when: 'evening' },
    { task: 'Book dentist', why: 'Overdue.', duration: '~5min', when: 'lunch' },
  ],
  habitNote: 'Nice work keeping the streak.',
}

const noop = () => {}

describe('PlanBox', () => {
  it('shows the pre-generate empty state before a plan exists', () => {
    render(<PlanBox plan={null} paused={false} isPending={false} isError={false} onRetry={noop} />)
    expect(screen.getByText(/reads your grid, recurring chores, and habits/i)).toBeInTheDocument()
    expect(screen.getByText('Plan My Day')).toBeInTheDocument() // the <em> prompt
  })

  it('renders the full plan: headline, available time, big rock, small rocks, habit note', () => {
    render(<PlanBox plan={PLAN} paused={false} isPending={false} isError={false} onRetry={noop} />)
    expect(screen.getByText('A focused but gentle day.')).toBeInTheDocument()
    expect(screen.getByText(/~4\.5h — lunch \+ evening/)).toBeInTheDocument()
    expect(screen.getByText('Big rock')).toBeInTheDocument()
    expect(screen.getByText('File taxes')).toBeInTheDocument()
    // then / also prefixes for small rocks under a big rock
    expect(screen.getByText('then')).toBeInTheDocument()
    expect(screen.getByText('also')).toBeInTheDocument()
    expect(screen.getByText('Email landlord')).toBeInTheDocument()
    expect(screen.getByText('Book dentist')).toBeInTheDocument()
    expect(screen.getByText(/Nice work keeping the streak\./)).toBeInTheDocument()
  })

  it('uses bullets for small rocks when there is no big rock', () => {
    render(
      <PlanBox
        plan={{ ...PLAN, bigRock: null }}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
      />,
    )
    expect(screen.queryByText('Big rock')).not.toBeInTheDocument()
    expect(screen.getAllByText('•')).toHaveLength(2)
  })

  it('shows a loading state while planning with no plan yet', () => {
    render(<PlanBox plan={null} paused={false} isPending={true} isError={false} onRetry={noop} />)
    expect(screen.getByText(/Planning your day/i)).toBeInTheDocument()
  })

  it('keeps the saved plan visible while regenerating (card does not flip to loading)', () => {
    render(<PlanBox plan={PLAN} paused={false} isPending={true} isError={false} onRetry={noop} />)
    expect(screen.getByText('A focused but gentle day.')).toBeInTheDocument()
    expect(screen.queryByText(/Planning your day/i)).not.toBeInTheDocument()
  })

  it('shows an error with a retry when generation fails and there is no plan', () => {
    const onRetry = vi.fn()
    render(
      <PlanBox plan={null} paused={false} isPending={false} isError={true} onRetry={onRetry} />,
    )
    expect(screen.getByText(/Couldn't generate a plan/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows the paused notice when AI is paused and no plan exists', () => {
    render(<PlanBox plan={null} paused={true} isPending={false} isError={false} onRetry={noop} />)
    expect(screen.getByText(/AI is paused for this month/i)).toBeInTheDocument()
  })
})
