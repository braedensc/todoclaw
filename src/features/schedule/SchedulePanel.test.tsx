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
    ongoing: false,
    timeZone: TZ,
    onSetDue: vi.fn(),
    onSetRecurring: vi.fn(),
    onSetFrequency: vi.fn(),
    onRemoveRecurring: vi.fn(),
    onSetOngoing: vi.fn(),
    reminderOffsets: [] as number[],
    onToggleReminder: vi.fn(),
    onClearReminders: vi.fn(),
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

  it('remind chips appear only with a due time', () => {
    renderPanel({ due: '2026-07-10' })
    expect(screen.queryByTestId('reminder-picker-grid')).not.toBeInTheDocument()

    renderPanel({ due: '2026-07-10', dueTime: '15:00:00', idPrefix: 'grid' })
    expect(screen.getByTestId('reminder-picker-grid')).toBeInTheDocument()
  })

  it('a recurring task shows the SAME offset picker (unified 2026-07-12), with a per-cycle note', () => {
    // A recurring reminder is now the offset model too — it leads each occurrence, anchored to the
    // task's due date+time. So the recurring panel shows the same ReminderPicker as a one-off,
    // gated on the due time, plus a one-line note that it fires before each recurrence.
    renderPanel({
      due: '2026-07-10',
      dueTime: '15:00:00',
      recurring: recurringWeekly,
      idPrefix: 'grid',
    })
    expect(screen.getByTestId('reminder-picker-grid')).toBeInTheDocument()
    expect(screen.getByText(/before each time it comes back/i)).toBeInTheDocument()
  })

  it('a recurring task without a due time still gates the offset picker off', () => {
    renderPanel({ recurring: recurringWeekly, idPrefix: 'grid' })
    expect(screen.queryByTestId('reminder-picker-grid')).not.toBeInTheDocument()
  })

  it('reminder chips are multi-select: a chip toggles one offset, Off clears them all', () => {
    const p = renderPanel({
      due: '2026-07-10',
      dueTime: '15:00:00',
      reminderOffsets: [60],
      idPrefix: 'grid',
    })
    const picker = within(screen.getByTestId('reminder-picker-grid'))
    expect(picker.getByRole('button', { name: '1 hour' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(picker.getByRole('button', { name: '1 day' }))
    expect(p.onToggleReminder).toHaveBeenLastCalledWith(1440)
    // Off lives inside the picker; the Repeats "Off" is a separate control outside it.
    fireEvent.click(picker.getByRole('button', { name: 'Off' }))
    expect(p.onClearReminders).toHaveBeenCalled()
  })
})

describe('SchedulePanel type switch', () => {
  const typeGroup = () => within(screen.getByRole('group', { name: 'Task type' }))

  it('shows the three mutually-exclusive types, with the current one pressed', () => {
    renderPanel({ recurring: recurringWeekly })
    const g = typeGroup()
    expect(g.getByRole('button', { name: 'Recurring' })).toHaveAttribute('aria-pressed', 'true')
    expect(g.getByRole('button', { name: 'Task' })).toHaveAttribute('aria-pressed', 'false')
    expect(g.getByRole('button', { name: 'Ongoing' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switching a plain task to Recurring starts a fresh weekly schedule', () => {
    const p = renderPanel()
    fireEvent.click(typeGroup().getByRole('button', { name: 'Recurring' }))
    expect(p.onSetRecurring).toHaveBeenCalledWith(7)
    // The cadence control is hidden until the task actually becomes recurring.
    expect(screen.queryByRole('group', { name: 'Repeats' })).toBeNull()
  })

  it('switching a plain task to Ongoing sets the flag', () => {
    const p = renderPanel()
    fireEvent.click(typeGroup().getByRole('button', { name: 'Ongoing' }))
    expect(p.onSetOngoing).toHaveBeenCalledWith(true)
  })

  it('switching a recurring task back to Task drops the schedule', () => {
    const p = renderPanel({ recurring: recurringWeekly })
    fireEvent.click(typeGroup().getByRole('button', { name: 'Task' }))
    expect(p.onRemoveRecurring).toHaveBeenCalled()
  })

  it('switching an ongoing task back to Task clears the flag', () => {
    const p = renderPanel({ ongoing: true })
    fireEvent.click(typeGroup().getByRole('button', { name: 'Task' }))
    expect(p.onSetOngoing).toHaveBeenCalledWith(false)
  })

  it('switching an ongoing task to Recurring starts a schedule (parent clears the flag)', () => {
    const p = renderPanel({ ongoing: true })
    fireEvent.click(typeGroup().getByRole('button', { name: 'Recurring' }))
    expect(p.onSetRecurring).toHaveBeenCalledWith(7)
  })
})

describe('SchedulePanel recurring cadence', () => {
  // The Daily/Weekly/Every… cadence control only appears once the task IS recurring.
  it('Daily on a recurring task retunes the cadence via onSetFrequency', () => {
    const p = renderPanel({ recurring: recurringWeekly })
    fireEvent.click(screen.getByRole('button', { name: 'Daily' }))
    expect(p.onSetFrequency).toHaveBeenCalledWith(1)
    expect(p.onSetRecurring).not.toHaveBeenCalled()
  })

  it('Weekly on a daily-recurring task retunes to 7 via onSetFrequency', () => {
    const p = renderPanel({ recurring: { ...recurringWeekly, frequencyDays: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(p.onSetFrequency).toHaveBeenCalledWith(7)
  })

  it('Every… commits the seed cadence on tap; ± adjusts it', () => {
    const p = renderPanel({ recurring: recurringWeekly })
    fireEvent.click(screen.getByRole('button', { name: 'Every…' }))
    // Opening Every… IS choosing a cadence — the 3-day seed is committed immediately.
    expect(p.onSetFrequency).toHaveBeenCalledWith(3)
    fireEvent.click(screen.getByRole('button', { name: 'More days between repeats' }))
    expect(p.onSetFrequency).toHaveBeenCalledWith(4)
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

describe('SchedulePanel ongoing project', () => {
  it('an ongoing task shows the explainer and no cadence control', () => {
    renderPanel({ ongoing: true })
    // No Daily/Weekly cadence for an ongoing project — it behaves like a plain task.
    expect(screen.queryByRole('group', { name: 'Repeats' })).toBeNull()
    expect(screen.getByText(/standing, open-ended effort/i)).toBeInTheDocument()
  })

  it('shares the due/time controls (an ongoing task can carry a due date)', () => {
    // The calendar renders for every type — an ongoing project can take a far-out due date.
    renderPanel({ ongoing: true, due: '2026-07-10' })
    expect(screen.getByTestId('schedule-calendar')).toBeInTheDocument()
  })
})
