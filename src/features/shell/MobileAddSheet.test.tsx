import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Task, Recurring } from '../../types/task'
import { MobileAddSheet } from './MobileAddSheet'
import { quadrantMeta } from '../../lib/quadrants'

let tasksData: Task[] = []
const addMutate = vi.fn()

vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => ({ data: tasksData }),
  useAddTask: () => ({ mutate: addMutate }),
}))

// AddTaskForm renders DueTimezoneHint (useUserSchedule → useQuery). Mock it with the HOST's own
// zone so the hint is deterministically absent on any machine (its behavior has its own tests).
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({
    data: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, config: {} },
  }),
}))
vi.mock('../reminders/use-task-reminders', () => ({
  useTaskReminders: () => ({ data: new Map() }),
  useTaskReminderWrites: () => ({ add: vi.fn(), remove: vi.fn(), clear: vi.fn(), toggle: vi.fn() }),
  useRecurringReminder: () => ({ data: new Map() }),
  useRecurringReminderWrites: () => ({ set: vi.fn(), remove: vi.fn() }),
}))

function renderSheet(over: Partial<Parameters<typeof MobileAddSheet>[0]> = {}) {
  const onClose = vi.fn()
  render(<MobileAddSheet open defaultQuadrant={null} onClose={onClose} {...over} />)
  return { onClose }
}

beforeEach(() => {
  tasksData = []
  addMutate.mockClear()
})

describe('MobileAddSheet', () => {
  it('shows the manual text + quadrant + schedule form, with no AI/BabyClaw toggle', () => {
    renderSheet()
    // AI capture lives in the Chat tab now — the add sheet is manual-only, no mode switcher.
    expect(screen.queryByRole('group', { name: 'Add mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Manual/ })).not.toBeInTheDocument()
    // The manual form is present from the start: text, quadrant picker, and the schedule
    // DISCLOSURE (the SchedulePanel unfolds on demand so plain capture stays one screen tall).
    expect(screen.getByLabelText('Task text')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schedule' })).toBeInTheDocument() // the quadrant
    const disclosure = screen.getByRole('button', { name: /Add schedule/ })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('group', { name: 'Repeats' })).not.toBeInTheDocument()

    fireEvent.click(disclosure)
    expect(screen.getByRole('group', { name: 'Repeats' })).toBeInTheDocument()
    expect(screen.getByTestId('schedule-calendar')).toBeInTheDocument()
  })

  it('does NOT auto-focus the text field (the keyboard must not pop on open)', () => {
    renderSheet()
    expect(document.activeElement).not.toBe(screen.getByLabelText('Task text'))
  })

  it('manual add creates a PLACED one-off task in the chosen quadrant and closes', () => {
    const { onClose } = renderSheet()

    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'file taxes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))

    expect(addMutate).toHaveBeenCalledTimes(1)
    const arg = addMutate.mock.calls[0]![0] as {
      text: string
      x: number
      y: number
      staged: boolean
      recurring: Recurring | null
    }
    expect(arg.text).toBe('file taxes')
    expect(arg.staged).toBe(false)
    expect(arg.recurring).toBeNull()
    expect(quadrantMeta(arg.x, arg.y).key).toBe('schedule')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a Daily repeat ships a fresh recurring schedule on the same insert', () => {
    renderSheet()

    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'stretch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Do Now' }))
    fireEvent.click(screen.getByRole('button', { name: /Add schedule/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Daily' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))

    const arg = addMutate.mock.calls[0]![0] as { recurring: Recurring | null }
    expect(arg.recurring).toEqual({ frequencyDays: 1, lastDoneAt: null, doneCount: 0 })
  })

  it('an Every… repeat commits its seed cadence and ± adjusts it before Add', () => {
    renderSheet()

    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'water plants' } })
    fireEvent.click(screen.getByRole('button', { name: 'Errands' }))
    fireEvent.click(screen.getByRole('button', { name: /Add schedule/ }))
    // Every… commits the 3-day seed immediately (consistent with Daily/Weekly); + bumps to 4.
    fireEvent.click(screen.getByRole('button', { name: 'Every…' }))
    fireEvent.click(screen.getByRole('button', { name: 'More days between repeats' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))

    const arg = addMutate.mock.calls[0]![0] as { recurring: Recurring | null }
    expect(arg.recurring).toEqual({ frequencyDays: 4, lastDoneAt: null, doneCount: 0 })
  })

  it('the 🐾 chat tip closes the sheet and opens the chat', () => {
    const onOpenChat = vi.fn()
    const { onClose } = renderSheet({ onOpenChat })

    fireEvent.click(screen.getByRole('button', { name: /fastest way to add/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpenChat).toHaveBeenCalledTimes(1)
    expect(addMutate).not.toHaveBeenCalled()
  })

  it('pre-selects the focused quadrant when one is passed', () => {
    renderSheet({ defaultQuadrant: 'do-now' })
    expect(screen.getByRole('button', { name: 'Do Now' })).toHaveAttribute('aria-pressed', 'true')
  })
})
