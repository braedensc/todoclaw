import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SchedulePanel } from './SchedulePanel'
import type { Recurring } from '../../types/task'

// The one schedule editor (workshop direction B): a two-week TZ-aware calendar + time preset
// chips + remind chips + a Repeats segmented control. These tests pin the WRITE semantics the
// panel inherited from the inputs it replaced (due+time always written together; Daily/Weekly
// preserve an existing schedule's history via onSetFrequency; a fresh schedule goes through
// onSetRecurring) and the calendar's timezone anchoring.

// DueTimezoneHint reads the user_schedule query; the panel's own logic doesn't. Stub it out.
vi.mock('./use-user-schedule', () => ({
  useUserSchedule: () => ({ data: undefined }),
}))

// Fixed clock: Thursday 2026-07-09 (UTC). The fortnight shown = Mon Jul 6 … Sun Jul 19.
const NOW = new Date('2026-07-09T12:00:00Z')
const TZ = 'UTC'

const recurringWeekly: Recurring = {
  frequencyDays: 7,
  lastDoneAt: '2026-07-01T00:00:00Z',
  doneCount: 4,
}

function renderPanel(over: Partial<Parameters<typeof SchedulePanel>[0]> = {}) {
  const props = {
    taskText: 'Email race organizers',
    due: null as string | null,
    dueTime: null as string | null,
    recurring: null as Recurring | null,
    timeZone: TZ,
    onSetDue: vi.fn(),
    onSetRecurring: vi.fn(),
    onSetFrequency: vi.fn(),
    onRemoveRecurring: vi.fn(),
    reminderOffset: null as number | null,
    onSetReminder: vi.fn(),
    now: NOW,
    ...over,
  }
  render(<SchedulePanel {...props} />)
  return props
}

const calendar = () => within(screen.getByTestId('schedule-calendar'))

describe('SchedulePanel calendar', () => {
  it('shows a Monday-start fortnight around today (timezone-aware) with today marked', () => {
    renderPanel()
    const cells = calendar().getAllByRole('button')
    expect(cells).toHaveLength(14)
    // Monday Jul 6 first, Sunday Jul 19 last, today (Thu Jul 9) present.
    expect(cells[0]).toHaveAccessibleName(/Mon.*Jul.*6/)
    expect(cells[13]).toHaveAccessibleName(/Sun.*Jul.*19/)
    expect(calendar().getByRole('button', { name: /Thu.*Jul.*9/ })).toBeInTheDocument()
  })

  it('west-of-UTC timezones anchor "today" to the user’s day, not the UTC day', () => {
    // At 2026-07-09T02:00Z it is still Jul 8 in Los Angeles — the fortnight starts Mon Jul 6
    // and today = Wed Jul 8 (would wrongly be Thu Jul 9 if anchored to UTC).
    renderPanel({ timeZone: 'America/Los_Angeles', now: new Date('2026-07-09T02:00:00Z') })
    expect(calendar().getByRole('button', { name: /Wed.*Jul.*8/ })).toBeInTheDocument()
  })

  it('picking a day writes due (keeping any set time); No date clears both', () => {
    const p = renderPanel({ due: '2026-07-06', dueTime: '15:00:00' })
    fireEvent.click(calendar().getByRole('button', { name: /Fri.*Jul.*10/ }))
    expect(p.onSetDue).toHaveBeenCalledWith('2026-07-10', '15:00')

    fireEvent.click(screen.getByRole('button', { name: 'No date' }))
    expect(p.onSetDue).toHaveBeenCalledWith(null, null)
  })

  it('marks the stored due day as pressed', () => {
    renderPanel({ due: '2026-07-11' })
    expect(calendar().getByRole('button', { name: /Sat.*Jul.*11/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('“More dates…” reveals the native date input; an off-fortnight due opens it pre-filled', () => {
    renderPanel({ due: '2026-08-01' })
    // Off-grid due → the escape hatch is already open and holds the value.
    expect(screen.getByLabelText('Due date')).toHaveValue('2026-08-01')
  })

  it('the native date input keeps the write-both-columns contract', () => {
    const p = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '📅 More dates…' }))
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-08-01' } })
    expect(p.onSetDue).toHaveBeenCalledWith('2026-08-01', null)
  })
})

describe('SchedulePanel time + remind', () => {
  it('time chips wait for a date', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: '9 AM' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Custom…' })).toBeDisabled()
  })

  it('presets write the time with the date; None clears only the time', () => {
    const p = renderPanel({ due: '2026-07-10' })
    fireEvent.click(screen.getByRole('button', { name: '6 PM' }))
    expect(p.onSetDue).toHaveBeenCalledWith('2026-07-10', '18:00')

    fireEvent.click(screen.getByRole('button', { name: 'None' }))
    expect(p.onSetDue).toHaveBeenCalledWith('2026-07-10', null)
  })

  it('Custom… reveals the native time input; a non-preset stored time is shown in it', () => {
    const p = renderPanel({ due: '2026-07-10', dueTime: '12:30:00' })
    const input = screen.getByLabelText('Due time')
    expect(input).toHaveValue('12:30')
    fireEvent.change(input, { target: { value: '07:45' } })
    expect(p.onSetDue).toHaveBeenCalledWith('2026-07-10', '07:45')
  })

  it('remind chips appear only with a due time, and never for a recurring task', () => {
    renderPanel({ due: '2026-07-10' })
    expect(screen.queryByTestId('reminder-picker-grid')).not.toBeInTheDocument()

    renderPanel({ due: '2026-07-10', dueTime: '15:00:00', idPrefix: 'grid' })
    expect(screen.getByTestId('reminder-picker-grid')).toBeInTheDocument()
  })

  it('recurring hides the remind section even with a due time', () => {
    renderPanel({
      due: '2026-07-10',
      dueTime: '15:00:00',
      recurring: recurringWeekly,
      idPrefix: 'grid',
    })
    expect(screen.queryByTestId('reminder-picker-grid')).not.toBeInTheDocument()
  })
})

describe('SchedulePanel repeats', () => {
  it('Daily on a non-recurring task starts a fresh schedule', () => {
    const p = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Daily' }))
    expect(p.onSetRecurring).toHaveBeenCalledWith(1)
    expect(p.onSetFrequency).not.toHaveBeenCalled()
  })

  it('Weekly on an already-recurring task preserves history via onSetFrequency', () => {
    const p = renderPanel({ recurring: { ...recurringWeekly, frequencyDays: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(p.onSetFrequency).toHaveBeenCalledWith(7)
    expect(p.onSetRecurring).not.toHaveBeenCalled()
  })

  it('Off removes the schedule', () => {
    const p = renderPanel({ recurring: recurringWeekly })
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(p.onRemoveRecurring).toHaveBeenCalled()
  })

  it('Every… opens the stepper; ± commits the clamped cadence', () => {
    const p = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Every…' }))
    // Seeded at 3; nothing written until a press.
    expect(p.onSetRecurring).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'More days between repeats' }))
    expect(p.onSetRecurring).toHaveBeenCalledWith(4)
  })

  it('a non-preset cadence reads as Every… with the stepper visible', () => {
    renderPanel({ recurring: { ...recurringWeekly, frequencyDays: 3 } })
    expect(screen.getByRole('button', { name: 'Every…' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('3 days')).toBeInTheDocument()
  })

  it('an active repeat reads back in plain words with the 🦴 stamp + live status', () => {
    renderPanel({ recurring: recurringWeekly })
    expect(screen.getByText(/comes back weekly 🦴/)).toBeInTheDocument()
  })
})
