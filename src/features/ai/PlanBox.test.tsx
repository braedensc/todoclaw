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
  it('renders nothing when idle with no plan (no placeholder, no box)', () => {
    const { container } = render(
      <PlanBox
        plan={null}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the full plan: headline, available time, big rock, small rocks, habit note', () => {
    render(
      <PlanBox
        plan={PLAN}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
      />,
    )
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

  it('no longer renders the AI privacy note inside the plan card', () => {
    render(
      <PlanBox
        plan={PLAN}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
      />,
    )
    expect(screen.queryByText(/owner's Anthropic key/i)).not.toBeInTheDocument()
  })

  it('shows a dismiss × on the plan and fires onDismiss when clicked', () => {
    const onDismiss = vi.fn()
    render(
      <PlanBox
        plan={PLAN}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /dismiss plan/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('mobile: swaps the corner × for a full-width footer "Dismiss today\'s plan" button', () => {
    const onDismiss = vi.fn()
    render(
      <PlanBox
        mobile
        plan={PLAN}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={onDismiss}
      />,
    )
    // No tiny corner × on mobile…
    expect(screen.queryByRole('button', { name: /dismiss plan/i })).not.toBeInTheDocument()
    // …the labelled footer button fires onDismiss instead.
    fireEvent.click(screen.getByRole('button', { name: /Dismiss today's plan/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not show a dismiss × when there is no plan (loading state)', () => {
    render(
      <PlanBox
        plan={null}
        paused={false}
        isPending={true}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
      />,
    )
    expect(screen.queryByRole('button', { name: /dismiss plan/i })).not.toBeInTheDocument()
  })

  it('uses bullets for small rocks when there is no big rock', () => {
    render(
      <PlanBox
        plan={{ ...PLAN, bigRock: null }}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
      />,
    )
    expect(screen.queryByText('Big rock')).not.toBeInTheDocument()
    expect(screen.getAllByText('•')).toHaveLength(2)
  })

  it('shows a loading state while planning with no plan yet', () => {
    render(
      <PlanBox
        plan={null}
        paused={false}
        isPending={true}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
      />,
    )
    expect(screen.getByText(/Planning your day/i)).toBeInTheDocument()
  })

  it('keeps the saved plan visible while regenerating (card does not flip to loading)', () => {
    render(
      <PlanBox
        plan={PLAN}
        paused={false}
        isPending={true}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
      />,
    )
    expect(screen.getByText('A focused but gentle day.')).toBeInTheDocument()
    expect(screen.queryByText(/Planning your day/i)).not.toBeInTheDocument()
  })

  it('shows an error with a retry when generation fails and there is no plan', () => {
    const onRetry = vi.fn()
    render(
      <PlanBox
        plan={null}
        paused={false}
        isPending={false}
        isError={true}
        onRetry={onRetry}
        onDismiss={noop}
      />,
    )
    expect(screen.getByText(/Couldn't generate a plan/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows the paused notice when AI is paused and no plan exists', () => {
    render(
      <PlanBox
        plan={null}
        paused={true}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
      />,
    )
    expect(screen.getByText(/AI is paused for this month/i)).toBeInTheDocument()
  })

  it('scratches a rock off (✓ + line-through + a11y "Done:") once rockDone says so', () => {
    render(
      <PlanBox
        plan={PLAN}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
        // The big rock and the FIRST small rock are done; the second small rock stays open.
        rockDone={(rock) => rock.task === 'File taxes' || rock.task === 'Email landlord'}
      />,
    )
    // Struck: the task text itself carries line-through, with a leading ✓ and a screen-reader
    // "Done:" (line-through alone is invisible to a11y tech).
    expect(screen.getByText('File taxes').className).toContain('line-through')
    expect(screen.getByText('Email landlord').className).toContain('line-through')
    expect(screen.getAllByText('✓')).toHaveLength(2)
    expect(screen.getAllByText('Done:')).toHaveLength(2)
    // The open rock is untouched — no strike, still ink-colored.
    expect(screen.getByText('Book dentist').className).not.toContain('line-through')
    // Chips/why remain visible on a struck rock (dimmed, not removed).
    expect(screen.getByText(/Due tomorrow\./)).toBeInTheDocument()
  })

  it('renders no strikethrough at all without a rockDone prop (DemoScene) or when nothing is done', () => {
    const { rerender } = render(
      <PlanBox
        plan={PLAN}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
      />,
    )
    expect(screen.queryByText('✓')).not.toBeInTheDocument()
    rerender(
      <PlanBox
        plan={PLAN}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
        rockDone={() => false}
      />,
    )
    expect(screen.queryByText('✓')).not.toBeInTheDocument()
    expect(screen.getByText('File taxes').className).not.toContain('line-through')
  })
})
