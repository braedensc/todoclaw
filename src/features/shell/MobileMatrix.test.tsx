import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { Task } from '../../types/task'
import { MobileMatrix } from './MobileMatrix'
import { ConfirmProvider } from '../../components/use-confirm'

// MobileMatrix drives the mobile overview→focus experience. It reuses ListView for the focus rows,
// so the same module-level hook mocks (paths resolve from features/shell/ to the SAME modules
// ListView imports) cover both. ConfirmProvider wraps it because the focus ListView needs it.

function renderMatrix() {
  return render(
    <ConfirmProvider>
      <MobileMatrix />
    </ConfirmProvider>,
  )
}

let tasksData: Task[] = []
let doneToday: Record<string, true> = {}

vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => ({ data: tasksData, isLoading: false, isError: false }),
  useUpdateTask: () => ({ mutate: vi.fn() }),
  useSoftDeleteTask: () => ({ mutate: vi.fn() }),
}))
vi.mock('../done/use-history', () => ({
  useMarkTaskDone: () => ({ mutate: vi.fn() }),
}))
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: { timezone: 'UTC' } }),
}))
vi.mock('../daily-state/use-daily-state', () => ({
  useDailyState: () => ({
    data: { done: doneToday, done_at: {}, habit_done: {}, subtask_done: {} },
  }),
}))

function makeTask(over: Partial<Task>): Task {
  return {
    id: 'id',
    user_id: 'u1',
    text: 'task',
    x: 0.5,
    y: 0.5,
    due: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    created_at: '2026-06-23T00:00:00Z',
    deleted_at: null,
    ...over,
  }
}

beforeEach(() => {
  tasksData = []
  doneToday = {}
})

// One placed task per quadrant, plus a second Do Now task so its count reads 2.
const onerPerQuadrant = () => [
  makeTask({ id: 'dn1', text: 'ship the release', x: 0.9, y: 0.9 }),
  makeTask({ id: 'dn2', text: 'call the bank', x: 0.6, y: 0.6 }),
  makeTask({ id: 'sc', text: 'draft roadmap', x: 0.1, y: 0.9 }),
  makeTask({ id: 'er', text: 'pick up parcel', x: 0.9, y: 0.1 }),
  makeTask({ id: 'sd', text: 'tidy bookshelf', x: 0.1, y: 0.1 }),
]

describe('MobileMatrix', () => {
  it('overview shows a cell per quadrant with its task count', () => {
    tasksData = onerPerQuadrant()
    renderMatrix()

    // aria-labels encode the count: "Do Now, 2 tasks", "Schedule, 1 task", …
    expect(screen.getByLabelText('Do Now, 2 tasks')).toBeInTheDocument()
    expect(screen.getByLabelText('Schedule, 1 task')).toBeInTheDocument()
    expect(screen.getByLabelText('Errands, 1 task')).toBeInTheDocument()
    expect(screen.getByLabelText('Someday, 1 task')).toBeInTheDocument()
    // The dominant (top-score) Do Now task previews in the overview.
    expect(screen.getByText('ship the release')).toBeInTheDocument()
  })

  it('drills into a quadrant focus list on tap, showing only that quadrant', () => {
    tasksData = onerPerQuadrant()
    renderMatrix()

    fireEvent.click(screen.getByLabelText('Schedule, 1 task'))

    // Focus view: the Schedule list renders its task; other quadrants are gone.
    expect(screen.getByRole('button', { name: /draft roadmap/ })).toBeInTheDocument()
    expect(screen.queryByText('pick up parcel')).not.toBeInTheDocument()
    expect(screen.queryByText('tidy bookshelf')).not.toBeInTheDocument()
    // A back control is offered.
    expect(screen.getByLabelText('Back to quadrant overview')).toBeInTheDocument()
  })

  it('the pager switches the focused quadrant without returning to the overview', () => {
    tasksData = onerPerQuadrant()
    renderMatrix()

    fireEvent.click(screen.getByLabelText('Schedule, 1 task'))
    expect(screen.getByRole('button', { name: /draft roadmap/ })).toBeInTheDocument()

    // The pager (nav "Quadrants") lets you jump straight to Errands.
    const pager = screen.getByRole('navigation', { name: 'Quadrants' })
    fireEvent.click(within(pager).getByRole('button', { name: /Errands/ }))

    expect(screen.getByRole('button', { name: /pick up parcel/ })).toBeInTheDocument()
    expect(screen.queryByText('draft roadmap')).not.toBeInTheDocument()
  })

  it('back returns to the overview', () => {
    tasksData = onerPerQuadrant()
    renderMatrix()

    fireEvent.click(screen.getByLabelText('Do Now, 2 tasks'))
    expect(screen.queryByLabelText('Do Now, 2 tasks')).not.toBeInTheDocument() // now in focus

    fireEvent.click(screen.getByLabelText('Back to quadrant overview'))
    expect(screen.getByLabelText('Do Now, 2 tasks')).toBeInTheDocument() // overview again
  })

  it('shows an empty overview cell as "Nothing here yet"', () => {
    tasksData = [makeTask({ id: 'dn', text: 'only task', x: 0.9, y: 0.9 })]
    renderMatrix()
    // Three of four quadrants are empty → the placeholder appears.
    expect(screen.getAllByText('Nothing here yet').length).toBe(3)
  })
})
