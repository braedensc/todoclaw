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
  useTaskReminderWrites: () => ({ add: vi.fn(), remove: vi.fn(), clear: vi.fn(), toggle: vi.fn() }),
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
    ongoing: false,
    created_at: '2026-06-23T00:00:00Z',
    deleted_at: null,
    completed_at: null,
    start_date: null,
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

  it('excludes a recurring task marked done today from the quadrant counts/preview', () => {
    // A recurring task never sets completed_at (it resets recurring.lastDoneAt). Without a
    // done-today hide it would linger in the quadrant preview after being marked done, so "done"
    // reads as a no-op. Done TODAY (UTC here) → hidden; it returns the next local day.
    tasksData = [
      makeTask({ id: 'dn-open', text: 'ship the release', x: 0.9, y: 0.9 }),
      makeTask({
        id: 'dn-rec',
        text: 'water the plants',
        x: 0.95,
        y: 0.95,
        recurring: { frequencyDays: 2, lastDoneAt: new Date().toISOString(), doneCount: 3 },
      }),
    ]
    doneToday = {}
    renderMatrix()

    expect(screen.getByLabelText('Do Now, 1 task')).toBeInTheDocument()
    expect(screen.getByText('ship the release')).toBeInTheDocument()
    expect(screen.queryByText('water the plants')).not.toBeInTheDocument()
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

  describe('paused (dormant) tasks', () => {
    // A month out is firmly future in the mocked UTC zone; now-relative so it can't rot.
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

    it('previews a placed dormant task dimmed in its quadrant, out of the active count and dueCounts', () => {
      const today = new Date().toISOString().slice(0, 10)
      tasksData = [
        makeTask({ id: 'dn', text: 'ship the release', x: 0.9, y: 0.9 }),
        // Dormant, placed in Schedule, and due TODAY — the due date must NOT light an on-fire badge.
        makeTask({
          id: 'pz',
          text: 'plan offsite',
          x: 0.1,
          y: 0.9,
          start_date: future,
          due: today,
        }),
      ]
      renderMatrix()

      // The paused task does NOT inflate Schedule's active count badge…
      expect(screen.getByLabelText('Schedule, 0 tasks')).toBeInTheDocument()
      // …but still previews in the Schedule cell, dimmed (set-aside).
      const row = screen.getByText('plan offsite').closest('li')!
      expect(row.style.opacity).not.toBe('')
      expect(parseFloat(row.style.opacity)).toBeLessThan(1)
      // …with a slate ⏸1 sub-count marking the quadrant as holding one paused task.
      expect(screen.getByTitle('1 paused')).toHaveTextContent('⏸1')
      // …and it is excluded from the due "on fire" counts: no "N today" badge appears.
      expect(screen.queryByText(/\d+ today/)).toBeNull()
    })

    it('ranks paused tasks AFTER active in a cell so they never displace the top-3', () => {
      // Three active + one paused, all in Do Now. The preview caps at 3 and active win every slot,
      // so the paused task is not previewed (but the ⏸1 sub-count still flags it).
      tasksData = [
        makeTask({ id: 'a', text: 'active one', x: 0.99, y: 0.99 }),
        makeTask({ id: 'b', text: 'active two', x: 0.9, y: 0.9 }),
        makeTask({ id: 'c', text: 'active three', x: 0.8, y: 0.8 }),
        makeTask({ id: 'p', text: 'paused four', x: 0.7, y: 0.7, start_date: future }),
      ]
      renderMatrix()

      expect(screen.getByLabelText('Do Now, 3 tasks')).toBeInTheDocument()
      // All three active tasks preview; the paused one is squeezed out of the 3 slots.
      expect(screen.getByText('active one')).toBeInTheDocument()
      expect(screen.getByText('active three')).toBeInTheDocument()
      expect(screen.queryByText('paused four')).toBeNull()
      // …but the sub-count still surfaces it.
      expect(screen.getByTitle('1 paused')).toHaveTextContent('⏸1')
    })
  })

  describe('unplaced strip', () => {
    // A task created without a position (BabyClaw create_task with no urgency/importance, or the
    // desktop widget's staged tray) — no quadrant, so before the strip it was invisible on mobile.
    const stagedTask = (over: Partial<Task> = {}) =>
      makeTask({ id: 'st1', text: 'sort the garage', x: null, y: null, staged: true, ...over })

    it('surfaces a staged task in the strip without counting it in any quadrant', () => {
      tasksData = [...onerPerQuadrant(), stagedTask()]
      renderMatrix()

      const strip = screen.getByRole('region', { name: 'Unplaced tasks' })
      expect(within(strip).getByText('Unplaced · 1')).toBeInTheDocument()
      expect(within(strip).getByText('sort the garage')).toBeInTheDocument()
      // Quadrant counts are unchanged — the staged task is in none of them.
      expect(screen.getByLabelText('Do Now, 2 tasks')).toBeInTheDocument()
      expect(screen.getByLabelText('Someday, 1 task')).toBeInTheDocument()
    })

    it('renders no strip when every task is placed', () => {
      tasksData = onerPerQuadrant()
      renderMatrix()
      expect(screen.queryByRole('region', { name: 'Unplaced tasks' })).not.toBeInTheDocument()
    })

    it('a staged task’s due date does not feed a quadrant due badge', () => {
      // Pre-fix, dueCounts bucketed null coords at (0.5, 0.5) — a staged task due today lit up a
      // quadrant it isn't in. Now-relative fixture: due "today" in the mocked UTC zone.
      const today = new Date().toISOString().slice(0, 10)
      tasksData = [makeTask({ id: 'dn', x: 0.9, y: 0.9 }), stagedTask({ due: today })]
      renderMatrix()
      expect(screen.queryByText(/1 today/)).not.toBeInTheDocument()
    })

    it('Place opens the picker with every quadrant selectable and titled "Place"', () => {
      tasksData = [...onerPerQuadrant(), stagedTask()]
      renderMatrix()

      fireEvent.click(screen.getByLabelText('Place sort the garage'))
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAccessibleName(/Place .*sort the garage/)
      // No current quadrant → nothing is disabled (unlike a placed task's move).
      for (const label of ['Do Now', 'Schedule', 'Errands', 'Someday']) {
        expect(within(dialog).getByRole('button', { name: `Move to ${label}` })).toBeEnabled()
      }
    })

    it('picking a quadrant materializes the task: coords inside it + staged:false', () => {
      tasksData = [...onerPerQuadrant(), stagedTask()]
      renderMatrix()

      fireEvent.click(screen.getByLabelText('Place sort the garage'))
      const dialog = screen.getByRole('dialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move to Schedule' }))

      expect(updateMutate).toHaveBeenCalledTimes(1)
      const arg = updateMutate.mock.calls[0]![0] as {
        id: string
        patch: { x: number; y: number; staged: boolean }
      }
      expect(arg.id).toBe('st1')
      expect(arg.patch.staged).toBe(false)
      expect(quadrantMeta(arg.patch.x, arg.patch.y).key).toBe('schedule')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
