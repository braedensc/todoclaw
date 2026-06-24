import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Task } from '../../types/task'
import { GridView } from './GridView'

// Mock the data layer so the grid renders under jsdom with no Supabase/network. Mutations are
// spies we assert against; the schedule/daily-state hooks return fixtures the tests override.
const updateMutate = vi.fn()
const softDeleteMutate = vi.fn()
const markDoneMutate = vi.fn()
let tasksFixture: Task[] = []
let doneTodayFixture: Record<string, boolean> = {}

vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => ({ data: tasksFixture }),
  useUpdateTask: () => ({ mutate: updateMutate }),
  useSoftDeleteTask: () => ({ mutate: softDeleteMutate }),
}))
vi.mock('../done/use-history', () => ({
  useMarkTaskDone: () => ({ mutate: markDoneMutate }),
}))
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: { timezone: 'America/New_York' } }),
}))
vi.mock('../daily-state/use-daily-state', () => ({
  useDailyState: () => ({
    data: { done: doneTodayFixture, done_at: {}, habit_done: {}, subtask_done: {} },
  }),
}))

// Build a Task with sane defaults; override per test.
function makeTask(over: Partial<Task>): Task {
  return {
    id: 'id-' + Math.random().toString(36).slice(2),
    user_id: 'u1',
    text: 'A task',
    x: 0.5,
    y: 0.5,
    due: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    created_at: '2026-06-23T00:00:00.000Z',
    deleted_at: null,
    ...over,
  }
}

beforeEach(() => {
  updateMutate.mockClear()
  softDeleteMutate.mockClear()
  markDoneMutate.mockClear()
  tasksFixture = []
  doneTodayFixture = {}
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GridView placement filter', () => {
  it('renders placed (non-staged) cards and hides staged ones', () => {
    tasksFixture = [
      makeTask({ id: 'placed', text: 'On the grid', staged: false }),
      makeTask({ id: 'staged', text: 'In the tray', staged: true }),
    ]
    render(<GridView />)

    const cards = screen.getAllByTestId('grid-card')
    expect(cards).toHaveLength(1)
    expect(within(cards[0]!).getByText('On the grid')).toBeInTheDocument()

    // The staged task shows in the tray, not on the grid.
    const trayCards = screen.getAllByTestId('tray-card')
    expect(trayCards).toHaveLength(1)
    expect(within(trayCards[0]!).getByText('In the tray')).toBeInTheDocument()
  })

  it('hides tasks marked done today', () => {
    tasksFixture = [makeTask({ id: 'done-task', text: 'Already done', staged: false })]
    doneTodayFixture = { 'done-task': true }
    render(<GridView />)

    expect(screen.queryByTestId('grid-card')).not.toBeInTheDocument()
    expect(screen.getByText('No tasks placed — drag one from the tray.')).toBeInTheDocument()
  })

  it('hides recurring tasks whose status is "ok" but shows due/overdue ones', () => {
    const recent = new Date(Date.now() - 86_400_000).toISOString() // 1 day ago
    tasksFixture = [
      makeTask({
        id: 'ok-rec',
        text: 'Not due yet',
        recurring: { frequencyDays: 30, lastDoneAt: recent, doneCount: 1 },
      }),
      makeTask({
        id: 'overdue-rec',
        text: 'Way overdue',
        recurring: { frequencyDays: 1, lastDoneAt: null, doneCount: 0 },
      }),
    ]
    render(<GridView />)

    expect(screen.queryByText('Not due yet')).not.toBeInTheDocument()
    expect(screen.getByText('Way overdue')).toBeInTheDocument()
  })

  it('shows the empty-tray state when nothing is staged', () => {
    tasksFixture = [makeTask({ staged: false })]
    render(<GridView />)
    expect(screen.getByText('Tray empty — add a task above.')).toBeInTheDocument()
  })
})

describe('GridView card visuals', () => {
  it('colors a non-recurring card top border by quadrant (Do Now = amber)', () => {
    tasksFixture = [makeTask({ id: 'donow', x: 0.8, y: 0.8 })]
    render(<GridView />)
    const card = screen.getByTestId('grid-card')
    // quadrantMeta(0.8,0.8) → Do Now #bf5e2a → rgb(191, 94, 42)
    expect(card.style.borderTopColor).toBe('rgb(191, 94, 42)')
  })

  it('colors a recurring card top border by recurring status (overdue = terracotta)', () => {
    tasksFixture = [
      makeTask({
        id: 'rec',
        x: 0.8,
        y: 0.8,
        recurring: { frequencyDays: 1, lastDoneAt: null, doneCount: 0 },
      }),
    ]
    render(<GridView />)
    const card = screen.getByTestId('grid-card')
    // RC_COLOR.overdue #c2693f → rgb(194, 105, 63)
    expect(card.style.borderTopColor).toBe('rgb(194, 105, 63)')
  })

  it('positions a card with y inverted (high importance near the top)', () => {
    tasksFixture = [makeTask({ id: 'pos', x: 0.25, y: 0.75 })]
    render(<GridView />)
    const card = screen.getByTestId('grid-card')
    expect(card.style.left).toBe('25%')
    // screenY = 1 - y = 0.25
    expect(card.style.top).toBe('25%')
  })

  it('renders the ×N recurring badge once doneCount >= 3', () => {
    const recent = new Date(Date.now() - 86_400_000).toISOString()
    tasksFixture = [
      makeTask({
        id: 'badge',
        recurring: { frequencyDays: 2, lastDoneAt: recent, doneCount: 4 },
      }),
    ]
    render(<GridView />)
    expect(screen.getByText('×4')).toBeInTheDocument()
  })
})

describe('GridView hover actions', () => {
  it('back-to-tray sets staged:true', () => {
    tasksFixture = [makeTask({ id: 'tray-me', staged: false })]
    render(<GridView />)
    fireEvent.click(screen.getByLabelText('Back to tray'))
    expect(updateMutate).toHaveBeenCalledWith({ id: 'tray-me', patch: { staged: true } })
  })

  it('delete soft-deletes the task', () => {
    tasksFixture = [makeTask({ id: 'del-me', staged: false })]
    render(<GridView />)
    fireEvent.click(screen.getByLabelText('Delete task'))
    expect(softDeleteMutate).toHaveBeenCalledWith('del-me')
  })

  it('inline edit commits a rename on Enter', () => {
    tasksFixture = [makeTask({ id: 'edit-me', text: 'Old name', staged: false })]
    render(<GridView />)
    fireEvent.click(screen.getByLabelText('Edit task'))
    const input = screen.getByLabelText('Edit task') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateMutate).toHaveBeenCalledWith({ id: 'edit-me', patch: { text: 'New name' } })
  })
})

describe('GridView grid mark-done', () => {
  it('marks a normal card done via the Done data layer (writes history)', () => {
    tasksFixture = [makeTask({ id: 'norm', text: 'Buy milk', bucket: 'oneoff', staged: false })]
    render(<GridView />)
    fireEvent.click(screen.getByLabelText('Done'))
    expect(markDoneMutate).toHaveBeenCalledWith({
      taskId: 'norm',
      text: 'Buy milk',
      bucket: 'oneoff',
      timeZone: 'America/New_York',
    })
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('resets a recurring card cycle (patches recurring) instead of writing history', () => {
    tasksFixture = [
      makeTask({
        id: 'rec',
        text: 'Water plants',
        recurring: { frequencyDays: 3, lastDoneAt: null, doneCount: 2 },
      }),
    ]
    render(<GridView />)
    fireEvent.click(screen.getByLabelText('Done (resets cycle)'))
    expect(markDoneMutate).not.toHaveBeenCalled()
    expect(updateMutate).toHaveBeenCalledTimes(1)
    const call = updateMutate.mock.calls[0]![0] as {
      id: string
      patch: { recurring: { lastDoneAt: string | null; doneCount: number; frequencyDays: number } }
    }
    expect(call.id).toBe('rec')
    expect(call.patch.recurring.frequencyDays).toBe(3)
    expect(call.patch.recurring.doneCount).toBe(3) // 2 + 1
    expect(call.patch.recurring.lastDoneAt).not.toBeNull() // cycle reset to now
  })
})

describe('GridView clustering', () => {
  // Two tasks within CX (0.09) / CY (0.07) of each other → one bubble, not two cards.
  it('collapses overlapping placed tasks into a single bubble with the count', () => {
    tasksFixture = [
      makeTask({ id: 'a', text: 'Clean kitchen', x: 0.5, y: 0.5 }),
      makeTask({ id: 'b', text: 'Clean bedroom', x: 0.52, y: 0.51 }),
    ]
    render(<GridView />)

    const bubbles = screen.getAllByTestId('cluster-bubble')
    expect(bubbles).toHaveLength(1)
    expect(within(bubbles[0]!).getByText('2')).toBeInTheDocument()
    // The cards are hidden inside the cluster until the popup opens.
    expect(screen.queryByTestId('grid-card')).not.toBeInTheDocument()
  })

  it('renders non-overlapping tasks as individual cards (no bubble)', () => {
    tasksFixture = [
      makeTask({ id: 'a', text: 'Top left', x: 0.1, y: 0.9 }),
      makeTask({ id: 'b', text: 'Bottom right', x: 0.9, y: 0.1 }),
    ]
    render(<GridView />)

    expect(screen.getAllByTestId('grid-card')).toHaveLength(2)
    expect(screen.queryByTestId('cluster-bubble')).not.toBeInTheDocument()
  })

  it('opens a popup listing the clustered tasks when the bubble is clicked', () => {
    tasksFixture = [
      makeTask({ id: 'a', text: 'Clean kitchen', x: 0.5, y: 0.5 }),
      makeTask({ id: 'b', text: 'Clean bedroom', x: 0.52, y: 0.51 }),
    ]
    render(<GridView />)

    expect(screen.queryByTestId('cluster-popup')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /tasks stacked here/ }))

    const popup = screen.getByTestId('cluster-popup')
    expect(within(popup).getByText('Clean kitchen')).toBeInTheDocument()
    expect(within(popup).getByText('Clean bedroom')).toBeInTheDocument()
    expect(within(popup).getByText('2 tasks here')).toBeInTheDocument()
  })

  it('marks a normal popup row done via the Done data layer', () => {
    tasksFixture = [
      makeTask({ id: 'a', text: 'Clean kitchen', bucket: 'oneoff', x: 0.5, y: 0.5 }),
      makeTask({ id: 'b', text: 'Clean bedroom', x: 0.52, y: 0.51 }),
    ]
    render(<GridView />)
    fireEvent.click(screen.getByRole('button', { name: /tasks stacked here/ }))

    const popup = screen.getByTestId('cluster-popup')
    const rowA = within(popup).getByText('Clean kitchen').closest('[data-task-id]') as HTMLElement
    fireEvent.click(within(rowA).getByLabelText('Mark done'))

    expect(markDoneMutate).toHaveBeenCalledWith({
      taskId: 'a',
      text: 'Clean kitchen',
      bucket: 'oneoff',
      timeZone: 'America/New_York',
    })
  })

  it('resets a recurring popup row cycle instead of writing history', () => {
    tasksFixture = [
      makeTask({
        id: 'rec',
        text: 'Water plants',
        x: 0.5,
        y: 0.5,
        recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 },
      }),
      makeTask({ id: 'b', text: 'Clean bedroom', x: 0.52, y: 0.51 }),
    ]
    render(<GridView />)
    fireEvent.click(screen.getByRole('button', { name: /tasks stacked here/ }))

    const popup = screen.getByTestId('cluster-popup')
    const recRow = within(popup).getByText('Water plants').closest('[data-task-id]') as HTMLElement
    fireEvent.click(within(recRow).getByLabelText('Mark done'))

    expect(markDoneMutate).not.toHaveBeenCalled()
    const call = updateMutate.mock.calls.find(
      (c) => (c[0] as { id: string }).id === 'rec',
    )?.[0] as { patch: { recurring: { doneCount: number } } }
    expect(call.patch.recurring.doneCount).toBe(1)
  })

  it('closes the popup when the grid background is clicked', () => {
    tasksFixture = [
      makeTask({ id: 'a', text: 'Clean kitchen', x: 0.5, y: 0.5 }),
      makeTask({ id: 'b', text: 'Clean bedroom', x: 0.52, y: 0.51 }),
    ]
    render(<GridView />)
    fireEvent.click(screen.getByRole('button', { name: /tasks stacked here/ }))
    expect(screen.getByTestId('cluster-popup')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByTestId('grid-canvas'))
    expect(screen.queryByTestId('cluster-popup')).not.toBeInTheDocument()
  })
})
