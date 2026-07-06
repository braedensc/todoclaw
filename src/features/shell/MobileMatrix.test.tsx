import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { Task } from '../../types/task'
import { MobileMatrix } from './MobileMatrix'
import { ConfirmProvider } from '../../components/use-confirm'
import { quadrantMeta } from '../../lib/quadrants'

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
const updateMutate = vi.fn()
const addMutate = vi.fn()

vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => ({ data: tasksData, isLoading: false, isError: false }),
  useUpdateTask: () => ({ mutate: updateMutate }),
  useAddTask: () => ({ mutate: addMutate }),
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
  updateMutate.mockClear()
  addMutate.mockClear()
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

  describe('move to quadrant', () => {
    function openMovePicker() {
      tasksData = onerPerQuadrant()
      renderMatrix()
      fireEvent.click(screen.getByLabelText('Do Now, 2 tasks'))
      // Move the top Do Now row ("ship the release").
      const row = screen.getByRole('button', { name: /ship the release/ }).closest('li')!
      fireEvent.click(within(row).getByLabelText('Move to quadrant'))
      return screen.getByRole('dialog')
    }

    it('opens the quadrant picker from a focus row', () => {
      const dialog = openMovePicker()
      expect(dialog).toHaveAccessibleName(/Move .*ship the release/)
      // All four quadrant targets are offered.
      expect(within(dialog).getByRole('button', { name: 'Move to Schedule' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Move to Errands' })).toBeInTheDocument()
    })

    it('the task’s current quadrant is not selectable', () => {
      const dialog = openMovePicker()
      // The task is in Do Now, so that target is disabled (a no-op move).
      expect(within(dialog).getByRole('button', { name: 'Move to Do Now' })).toBeDisabled()
    })

    it('picking a quadrant writes coords inside it and closes the sheet', () => {
      const dialog = openMovePicker()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move to Errands' }))

      expect(updateMutate).toHaveBeenCalledTimes(1)
      const arg = updateMutate.mock.calls[0]![0] as { id: string; patch: { x: number; y: number } }
      expect(arg.id).toBe('dn1')
      expect(quadrantMeta(arg.patch.x, arg.patch.y).key).toBe('errands')
      // Sheet dismissed.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('create into quadrant', () => {
    it('from the overview: requires a quadrant, then inserts a placed task there', () => {
      tasksData = onerPerQuadrant()
      renderMatrix()

      fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
      const dialog = screen.getByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('Task text'), {
        target: { value: 'file taxes' },
      })
      // No quadrant is pre-selected from the overview → the submit is disabled until one is picked.
      expect(within(dialog).getByRole('button', { name: 'Add task' })).toBeDisabled()

      fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }))
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add task' }))

      expect(addMutate).toHaveBeenCalledTimes(1)
      const arg = addMutate.mock.calls[0]![0] as {
        text: string
        x: number
        y: number
        staged: boolean
      }
      expect(arg.text).toBe('file taxes')
      expect(arg.staged).toBe(false)
      expect(quadrantMeta(arg.x, arg.y).key).toBe('schedule')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('from a focus view: pre-selects the focused quadrant so text alone can be added', () => {
      tasksData = onerPerQuadrant()
      renderMatrix()
      fireEvent.click(screen.getByLabelText('Do Now, 2 tasks'))

      fireEvent.click(screen.getByRole('button', { name: 'Add to Do Now' }))
      const dialog = screen.getByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('Task text'), {
        target: { value: 'urgent thing' },
      })
      // Do Now is pre-selected, so the submit is enabled with just text.
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add task' }))

      expect(addMutate).toHaveBeenCalledTimes(1)
      const arg = addMutate.mock.calls[0]![0] as { x: number; y: number }
      expect(quadrantMeta(arg.x, arg.y).key).toBe('do-now')
    })
  })
})
