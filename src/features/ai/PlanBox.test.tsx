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

  it('renders the quiet-day nudge as a distinct, no-pressure element (no Big rock pill)', () => {
    render(
      <PlanBox
        plan={{
          headline: 'Nothing pressing today — enjoy the breathing room.',
          availableTime: '~4.5h free this afternoon',
          bigRock: null,
          smallRocks: [],
          habitNote: 'Keep the water habit going.',
          nudge: {
            task: 'Write the novel',
            why: 'A relaxed hour would move it along.',
            duration: '~1h',
            taskId: 'task-9',
          },
        }}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
      />,
    )
    // The soft lead-in, the task, its why, and the "no pressure" chip all render…
    expect(screen.getByText(/If you're looking for something/i)).toBeInTheDocument()
    expect(screen.getByText('Write the novel')).toBeInTheDocument()
    expect(screen.getByText(/A relaxed hour would move it along\./)).toBeInTheDocument()
    expect(screen.getByText(/no pressure/i)).toBeInTheDocument()
    // …but it is NOT dressed up as a Big rock (that's the whole point).
    expect(screen.queryByText('Big rock')).not.toBeInTheDocument()
  })

  it('suppresses the nudge when a big rock exists (contract: nudge is a no-big-rock-day thing)', () => {
    render(
      <PlanBox
        // A malformed/persisted plan carrying BOTH — the card shows the big rock, hides the nudge.
        plan={{
          ...PLAN,
          nudge: { task: 'Tidy the garage', why: 'w', duration: '~1h', taskId: null },
        }}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
      />,
    )
    expect(screen.getByText('Big rock')).toBeInTheDocument()
    expect(screen.getByText('File taxes')).toBeInTheDocument()
    expect(screen.queryByText('Tidy the garage')).not.toBeInTheDocument()
    expect(screen.queryByText(/If you're looking for something/i)).not.toBeInTheDocument()
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

  it('collapses to a one-line summary that hides the body + dismiss, and expands on click', () => {
    const onToggleCollapse = vi.fn()
    render(
      <PlanBox
        plan={PLAN}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
        collapsed
        onToggleCollapse={onToggleCollapse}
      />,
    )
    // The headline stays as the summary…
    expect(screen.getByText('A focused but gentle day.')).toBeInTheDocument()
    // …but the plan body and the delete path are hidden while collapsed.
    expect(screen.queryByText('File taxes')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument()
    // The summary is a collapsed toggle; clicking it expands (does NOT dismiss/delete).
    const summary = screen.getByRole('button', { expanded: false })
    fireEvent.click(summary)
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })

  it('expanded: offers a Collapse toggle (distinct from Dismiss) that fires onToggleCollapse', () => {
    const onToggleCollapse = vi.fn()
    const onDismiss = vi.fn()
    render(
      <PlanBox
        plan={PLAN}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={onDismiss}
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
      />,
    )
    // Full plan is shown, plus a Collapse control separate from the Dismiss ×.
    expect(screen.getByText('File taxes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /collapse plan/i }))
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('without onToggleCollapse (DemoScene), a collapsed flag is ignored — the plan renders in full', () => {
    render(
      <PlanBox
        plan={PLAN}
        paused={false}
        isPending={false}
        isError={false}
        onRetry={noop}
        onDismiss={noop}
        collapsed
      />,
    )
    // No toggle wired → the card can't collapse; the body stays visible and no collapse control.
    expect(screen.getByText('File taxes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /collapse plan/i })).not.toBeInTheDocument()
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

  // Fixed times today (plan.anchors) — the regression this section exists for: an appointment due
  // today at a set hour used to be squeezed out of the card entirely by the bigRock/smallRocks caps.
  // It's derived from the board, not the model, so it always renders — even on a plan with no rocks.
  describe('fixed times today', () => {
    const ANCHORED: DayPlan = {
      ...PLAN,
      anchors: [
        { task: 'Timing belt & water pump', time: '2:00 PM', duration: '~half-day', taskId: 'car' },
        { task: 'Call with Sam', time: '9:30 AM', duration: null, taskId: 'sam' },
      ],
    }

    it('lists every anchor alongside the rocks', () => {
      render(
        <PlanBox
          plan={ANCHORED}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
        />,
      )
      expect(screen.getByText('Fixed times today')).toBeInTheDocument()
      expect(screen.getByText(/Timing belt & water pump/)).toBeInTheDocument()
      expect(screen.getByText('2:00 PM')).toBeInTheDocument()
      expect(screen.getByText(/Call with Sam/)).toBeInTheDocument()
      // The rocks are untouched — anchors are an addition, not a replacement.
      expect(screen.getByText('File taxes')).toBeInTheDocument()
    })

    it('shows how much of the day an anchor eats, and omits it when unsized', () => {
      render(
        <PlanBox
          plan={ANCHORED}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
        />,
      )
      // Seeing "~half-day" next to 2 PM is what makes a light plan underneath it read as correct.
      expect(screen.getByText('⏱ ~half-day')).toBeInTheDocument()
      // Exactly one anchor carries a length — the unsized 9:30 one gets no chip, not a made-up one.
      const strip = screen.getByText('Fixed times today').parentElement!
      expect(strip.querySelectorAll('li')).toHaveLength(2)
      expect(strip.textContent).not.toMatch(/⏱ null|⏱ undefined/)
      expect(strip.textContent!.match(/⏱/g)).toHaveLength(1)
    })

    it('shows anchors even when the plan has no rocks at all', () => {
      render(
        <PlanBox
          plan={{ ...ANCHORED, bigRock: null, smallRocks: [] }}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
        />,
      )
      expect(screen.getByText(/Timing belt & water pump/)).toBeInTheDocument()
    })

    it('strikes an anchor off once its task is done', () => {
      render(
        <PlanBox
          plan={ANCHORED}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
          rockDone={(r) => r.taskId === 'car'}
        />,
      )
      expect(screen.getByText(/Timing belt & water pump/).className).toContain('line-through')
      expect(screen.getByText(/Call with Sam/).className).not.toContain('line-through')
      expect(screen.getByText('Done:')).toBeInTheDocument()
    })

    it('renders no fixed-times section for a plan without anchors (or a legacy plan missing them)', () => {
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
      expect(screen.queryByText('Fixed times today')).not.toBeInTheDocument()
      rerender(
        <PlanBox
          plan={{ ...PLAN, anchors: [] }}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
        />,
      )
      expect(screen.queryByText('Fixed times today')).not.toBeInTheDocument()
    })
  })

  // Chores due today (plan.chores) — the regression this section exists for: a recurring chore due
  // TODAY had to win one of the two capped small-rock slots, and lost to tasks that weren't due for
  // days. Like anchors, it's derived from the board rather than chosen by the planner, so it always
  // renders — even on a plan with no rocks at all.
  describe('chores due today', () => {
    const CHORED: DayPlan = {
      ...PLAN,
      chores: [
        { task: 'Laundry', status: 'due today', taskId: 'laundry' },
        { task: 'Take out bins', status: 'overdue 2d', taskId: 'bins' },
      ],
    }

    it('lists every due chore alongside the rocks', () => {
      render(
        <PlanBox
          plan={CHORED}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
        />,
      )
      expect(screen.getByText('Chores due today')).toBeInTheDocument()
      expect(screen.getByText('Laundry')).toBeInTheDocument()
      expect(screen.getByText('due today')).toBeInTheDocument()
      // An overdue chore says so rather than passing for a fresh one.
      expect(screen.getByText('Take out bins')).toBeInTheDocument()
      expect(screen.getByText('overdue 2d')).toBeInTheDocument()
      // The rocks are untouched — the strip is an addition, not a replacement.
      expect(screen.getByText('File taxes')).toBeInTheDocument()
    })

    it('shows chores even when the plan has no rocks at all', () => {
      render(
        <PlanBox
          plan={{ ...CHORED, bigRock: null, smallRocks: [] }}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
        />,
      )
      expect(screen.getByText('Laundry')).toBeInTheDocument()
    })

    it('strikes a chore through once its task is done', () => {
      render(
        <PlanBox
          plan={CHORED}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
          rockDone={(r) => r.taskId === 'laundry'}
        />,
      )
      expect(screen.getByText('Laundry').className).toContain('line-through')
      expect(screen.getByText('Take out bins').className).not.toContain('line-through')
    })

    it('renders no chores section for a plan without them (or a legacy plan missing the field)', () => {
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
      expect(screen.queryByText('Chores due today')).not.toBeInTheDocument()
    })
  })

  // Checking items off ON the card (itemCheck). The card is a live surface, not a read-out: every
  // rock, fixed time and due chore carries a real checkbox wired to the same write the board's ✓
  // makes. Without the prop — the DemoScene's canned plan — the card stays exactly as it was, with
  // no checkboxes at all, which the strikethrough tests above pin.
  describe('check off', () => {
    const FULL: DayPlan = {
      ...PLAN,
      bigRock: { ...PLAN.bigRock!, taskId: 'taxes' },
      smallRocks: [
        {
          task: 'Email landlord',
          why: 'Quick.',
          duration: '~10min',
          when: 'evening',
          taskId: 'landlord',
        },
        {
          task: 'Book dentist',
          why: 'Overdue.',
          duration: '~5min',
          when: 'lunch',
          taskId: 'dentist',
        },
      ],
      anchors: [{ task: 'Timing belt', time: '2:00 PM', duration: '~half-day', taskId: 'car' }],
      chores: [{ task: 'Laundry', status: 'due today', taskId: 'laundry' }],
    }
    const live = (toggle: () => void) => () => ({ toggle, busy: false })

    it('gives every rock, fixed time and chore its own checkbox', () => {
      render(
        <PlanBox
          plan={FULL}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
          itemCheck={live(noop)}
        />,
      )
      // Each box is named for its item, so "check off Laundry" is unambiguous to a screen reader.
      for (const name of ['File taxes', 'Email landlord', 'Book dentist', 'Timing belt', 'Laundry'])
        expect(screen.getByRole('checkbox', { name })).toBeInTheDocument()
      expect(screen.getAllByRole('checkbox')).toHaveLength(5)
    })

    it('renders no checkboxes at all without the prop (the read-only demo card)', () => {
      render(
        <PlanBox
          plan={FULL}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
          rockDone={() => true}
        />,
      )
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    })

    it("ticking a box fires that item's toggle — and only that one", () => {
      const toggled: string[] = []
      render(
        <PlanBox
          plan={FULL}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
          itemCheck={(item) => ({ toggle: () => toggled.push(item.task), busy: false })}
        />,
      )
      fireEvent.click(screen.getByRole('checkbox', { name: 'Book dentist' }))
      expect(toggled).toEqual(['Book dentist'])
      fireEvent.click(screen.getByRole('checkbox', { name: 'Laundry' }))
      expect(toggled).toEqual(['Book dentist', 'Laundry'])
    })

    it('a box reads checked exactly when the item is done, and un-checking is a toggle back', () => {
      const toggle = vi.fn()
      render(
        <PlanBox
          plan={FULL}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
          rockDone={(r) => r.taskId === 'taxes'}
          itemCheck={live(toggle)}
        />,
      )
      expect(screen.getByRole('checkbox', { name: 'File taxes' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Book dentist' })).not.toBeChecked()
      // The done item is still tickable — clicking it asks for the un-done write.
      fireEvent.click(screen.getByRole('checkbox', { name: 'File taxes' }))
      expect(toggle).toHaveBeenCalledTimes(1)
    })

    it('a ticked box replaces the inline ✓ marker rather than doubling it up', () => {
      render(
        <PlanBox
          plan={FULL}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
          rockDone={(r) => r.taskId === 'taxes'}
          itemCheck={live(noop)}
        />,
      )
      // Struck through as before — but the checked box IS the done marker now (it announces its own
      // state), so the separate ✓ + screen-reader "Done:" pair is gone.
      expect(screen.getByText('File taxes').className).toContain('line-through')
      expect(screen.queryByText('Done:')).not.toBeInTheDocument()
    })

    it('an item with no task behind it gets an inert box, not a checkbox that does nothing', () => {
      render(
        <PlanBox
          plan={FULL}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
          // Only the big rock still resolves to a task; everything else was invented or deleted.
          itemCheck={(item) => (item.taskId === 'taxes' ? { toggle: noop, busy: false } : null)}
        />,
      )
      expect(screen.getAllByRole('checkbox')).toHaveLength(1)
      expect(screen.getByRole('checkbox', { name: 'File taxes' })).toBeInTheDocument()
      // The unmatched rows still render their text — they just can't be ticked from here.
      expect(screen.getByText('Laundry')).toBeInTheDocument()
    })

    it('an inert item that IS done keeps the screen-reader "Done:" (no box state to announce)', () => {
      render(
        <PlanBox
          plan={FULL}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
          rockDone={(r) => r.taskId === 'laundry'}
          itemCheck={() => null}
        />,
      )
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
      expect(screen.getByText('Done:')).toBeInTheDocument()
      expect(screen.getByText('Laundry').className).toContain('line-through')
    })

    it('disables the box whose write is in flight, so a double-tap cannot double-write', () => {
      const toggle = vi.fn()
      render(
        <PlanBox
          plan={FULL}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
          itemCheck={(item) => ({ toggle, busy: item.taskId === 'taxes' })}
        />,
      )
      const busy = screen.getByRole('checkbox', { name: 'File taxes' })
      expect(busy).toBeDisabled()
      fireEvent.click(busy)
      expect(toggle).not.toHaveBeenCalled()
      // Its neighbours stay live — one slow write doesn't freeze the card.
      fireEvent.click(screen.getByRole('checkbox', { name: 'Book dentist' }))
      expect(toggle).toHaveBeenCalledTimes(1)
    })

    it('leaves the quiet-day nudge unchecked-able — a suggestion is not an assignment', () => {
      render(
        <PlanBox
          plan={{
            ...FULL,
            bigRock: null,
            smallRocks: [],
            anchors: [],
            chores: [],
            nudge: {
              task: 'Sort the garage',
              why: 'Been meaning to.',
              duration: '~1h',
              taskId: 'g',
            },
          }}
          paused={false}
          isPending={false}
          isError={false}
          onRetry={noop}
          onDismiss={noop}
          itemCheck={live(noop)}
        />,
      )
      expect(screen.getByText('Sort the garage')).toBeInTheDocument()
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    })
  })
})
