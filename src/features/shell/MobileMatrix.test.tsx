import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { useState } from 'react'
import type { Task } from '../../types/task'
import type { QuadrantKey } from '../../lib/quadrants'
import { MobileMatrix } from './MobileMatrix'
import { ConfirmProvider } from '../../components/use-confirm'
import { quadrantMeta } from '../../lib/quadrants'

// MobileMatrix drives the mobile overview→focus experience. It reuses ListView for the focus rows,
// so the same module-level hook mocks (paths resolve from features/shell/ to the SAME modules
// ListView imports) cover both. ConfirmProvider wraps it because the focus ListView needs it.
//
// Focus state is App-owned now (use-quadrant-focus); this harness supplies a plain useState
// stand-in with the same QuadrantFocus shape, so these tests stay about MobileMatrix's rendering.
// The history/back semantics of the real hook are covered in use-quadrant-focus.test.ts.

function Harness() {
  const [focus, setFocus] = useState<QuadrantKey | null>(null)
  return (
    <ConfirmProvider>
      <MobileMatrix
        quadrantFocus={{
          focus,
          enter: setFocus,
          switchTo: setFocus,
          exit: () => setFocus(null),
          clear: () => setFocus(null),
        }}
      />
    </ConfirmProvider>
  )
}

function renderMatrix() {
  return render(<Harness />)
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
vi.mock('../reminders/use-task-reminders', () => ({
  useTaskReminders: () => ({ data: new Map() }),
  useUpsertTaskReminder: () => ({ mutate: vi.fn() }),
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
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    created_at: '2026-06-23T00:00:00Z',
    deleted_at: null,
    completed_at: null,
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

  it('excludes completed tasks from counts/preview even when today’s daily state is empty', () => {
    // Regression: a one-off completion lived only in today's daily_state.done map, so a fresh
    // (empty) day resurrected it. completed_at makes the hide permanent — the completed task
    // (higher score, so it would otherwise dominate the preview) stays out with doneToday empty.
    tasksData = [
      makeTask({ id: 'dn-open', text: 'ship the release', x: 0.9, y: 0.9 }),
      makeTask({
        id: 'dn-done',
        text: 'completed thing',
        x: 0.95,
        y: 0.95,
        completed_at: '2026-06-23T12:00:00Z',
      }),
    ]
    doneToday = {}
    renderMatrix()

    expect(screen.getByLabelText('Do Now, 1 task')).toBeInTheDocument()
    expect(screen.getByText('ship the release')).toBeInTheDocument()
    expect(screen.queryByText('completed thing')).not.toBeInTheDocument()
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
})
