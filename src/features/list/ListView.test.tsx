import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { Task } from '../../types/task'
import { ListView, type ListViewProps } from './ListView'
import { ConfirmProvider } from '../../components/use-confirm'
import { quadrantMeta } from '../../lib/quadrants'
import { resolveCollision } from '../../lib/collision'

// Component tests with all data hooks mocked (no Supabase, no network). We assert the
// behavior the list OWNS — ranking order, quadrant coloring, the whole-row expand toggle +
// double-click-to-edit, slider commit wiring, the unplaced badge, done-today exclusion, the
// done control's normal-vs-recurring branch, the confirm-gated delete, and the recurring
// set/remove controls. The pure logic itself (taskScore, resolveCollision math, recurring
// thresholds/colors) is covered in src/lib/*.test.ts.
//
// ListView calls useConfirm, so every render is wrapped in a real <ConfirmProvider> (renderList)
// — the same provider App mounts at the root — which also hosts the delete confirm dialog.

// Wrap ListView in the confirm provider it depends on (hosts the delete ConfirmDialog).
function renderList(props: ListViewProps = {}) {
  return render(
    <ConfirmProvider>
      <ListView {...props} />
    </ConfirmProvider>,
  )
}

const updateMutate = vi.fn()
const deleteMutate = vi.fn()
const markDoneMutate = vi.fn()
let tasksData: Task[] = []
let doneToday: Record<string, true> = {}

vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => ({ data: tasksData, isLoading: false, isError: false }),
  useUpdateTask: () => ({ mutate: updateMutate }),
  useSoftDeleteTask: () => ({ mutate: deleteMutate }),
}))
vi.mock('../done/use-history', () => ({
  useMarkTaskDone: () => ({ mutate: markDoneMutate }),
}))
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: { timezone: 'UTC' } }),
}))
vi.mock('../daily-state/use-daily-state', () => ({
  useDailyState: () => ({
    data: { done: doneToday, done_at: {}, habit_done: {}, subtask_done: {} },
  }),
}))

// A complete Task row with sensible defaults; override per test.
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
    ...over,
  }
}

beforeEach(() => {
  updateMutate.mockClear()
  deleteMutate.mockClear()
  markDoneMutate.mockClear()
  tasksData = []
  doneToday = {}
})

// A recent ISO timestamp (yesterday) so a recurring task with a real frequency reads as a
// live cycle rather than "never done". Used by the recurring-section tests.
const RECENT = new Date(Date.now() - 86_400_000).toISOString()

describe('ListView', () => {
  it('renders rows in descending score order', () => {
    // low score (someday corner) vs high score (do-now corner)
    tasksData = [
      makeTask({ id: 'low', text: 'low priority', x: 0.1, y: 0.1 }),
      makeTask({ id: 'high', text: 'high priority', x: 0.9, y: 0.9 }),
    ]
    renderList()

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    // First row is the higher-scoring task, ranked #1.
    expect(within(items[0]!).getByText('high priority')).toBeInTheDocument()
    expect(within(items[0]!).getByLabelText('Rank 1')).toBeInTheDocument()
    expect(within(items[1]!).getByText('low priority')).toBeInTheDocument()
    expect(within(items[1]!).getByLabelText('Rank 2')).toBeInTheDocument()
  })

  it('colors the rank number and left border by quadrant', () => {
    tasksData = [makeTask({ id: 'a', text: 'do now task', x: 0.9, y: 0.9 })]
    renderList()

    const color = quadrantMeta(0.9, 0.9).color // Do Now → #bf5e2a
    const rank = screen.getByLabelText('Rank 1')
    expect(rank).toHaveStyle({ color })
    const item = screen.getByRole('listitem')
    expect(item).toHaveStyle({ borderLeft: `4px solid ${color}` })
  })

  it('double-clicking the row opens an inline edit that commits via useUpdateTask', () => {
    tasksData = [makeTask({ id: 'edit-me', text: 'old text' })]
    renderList()

    fireEvent.dblClick(screen.getByText('old text'))
    const input = screen.getByLabelText('Edit task text')
    fireEvent.change(input, { target: { value: 'new text' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(updateMutate).toHaveBeenCalledWith({ id: 'edit-me', patch: { text: 'new text' } })
  })

  it('expanded-row due editors write BOTH due columns; clearing the date clears the time', () => {
    tasksData = [makeTask({ id: 'x', text: 'timed task', due: '2026-08-01', due_time: '15:00:00' })]
    renderList()
    fireEvent.click(screen.getByText('timed task'))

    // Badge surfaces the time for near dates via dueLabel — here just assert the inputs hydrate
    // from the wire formats ('YYYY-MM-DD' / 'HH:MM:SS' → 'HH:MM').
    expect(screen.getByLabelText('Due date')).toHaveValue('2026-08-01')
    expect(screen.getByLabelText('Due time')).toHaveValue('15:00')

    fireEvent.change(screen.getByLabelText('Due time'), { target: { value: '09:30' } })
    expect(updateMutate).toHaveBeenCalledWith({
      id: 'x',
      patch: { due: '2026-08-01', due_time: '09:30' },
    })

    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } })
    expect(updateMutate).toHaveBeenCalledWith({ id: 'x', patch: { due: null, due_time: null } })
  })

  it('single-clicking the row body toggles the expanded detail panel', () => {
    tasksData = [makeTask({ id: 'x', text: 'expand me' })]
    renderList()

    // Collapsed: the expand button reports aria-expanded=false and no sliders render.
    const rowButton = screen.getByRole('button', { name: /expand me/ })
    expect(rowButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Urgency slider')).not.toBeInTheDocument()

    // Clicking the row text (inside the row button) opens the panel…
    fireEvent.click(screen.getByText('expand me'))
    expect(screen.getByRole('button', { name: /expand me/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByLabelText('Urgency slider')).toBeInTheDocument()

    // …and clicking again collapses it.
    fireEvent.click(screen.getByText('expand me'))
    expect(screen.queryByLabelText('Urgency slider')).not.toBeInTheDocument()
  })

  it('runs collision resolution then commits resolved coords on slider commit', () => {
    // Two tasks: target's slider commit must avoid the blocker, so resolveCollision shifts it.
    const blocker = makeTask({ id: 'blocker', text: 'blocker', x: 0.9, y: 0.9 })
    const mover = makeTask({ id: 'mover', text: 'mover', x: 0.1, y: 0.1 })
    tasksData = [blocker, mover]
    renderList()

    // Expand the mover row (#2) by clicking its body, then drag its urgency slider to overlap.
    const moverRow = screen.getByText('mover').closest('li')!
    fireEvent.click(within(moverRow).getByText('mover'))
    const urgency = within(moverRow).getByLabelText('Urgency slider')
    fireEvent.change(urgency, { target: { value: '90' } })
    const importance = within(moverRow).getByLabelText('Importance slider')
    fireEvent.change(importance, { target: { value: '90' } })
    fireEvent.pointerUp(urgency)

    // Expected payload is exactly what resolveCollision returns for the same inputs.
    const expected = resolveCollision(0.9, 0.9, tasksData, 'mover')
    expect(updateMutate).toHaveBeenCalledWith({
      id: 'mover',
      patch: { x: expected.x, y: expected.y },
    })
    // The committed spot must NOT be the raw overlapping target — collision moved it.
    expect(expected).not.toEqual({ x: 0.9, y: 0.9 })
  })

  it('shows an "unplaced" badge for not-yet-placed (staged) tasks', () => {
    tasksData = [makeTask({ id: 's', text: 'staged task', staged: true })]
    renderList()
    expect(screen.getByText('unplaced')).toBeInTheDocument()
  })

  it('excludes tasks marked done today', () => {
    tasksData = [
      makeTask({ id: 'done', text: 'done today' }),
      makeTask({ id: 'open', text: 'still open' }),
    ]
    doneToday = { done: true }
    renderList()

    expect(screen.queryByText('done today')).not.toBeInTheDocument()
    expect(screen.getByText('still open')).toBeInTheDocument()
  })

  it('shows the empty state when there are no active tasks', () => {
    tasksData = []
    renderList()
    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument()
  })

  describe('done control', () => {
    it('marks a NORMAL task done via useMarkTaskDone (not useUpdateTask)', () => {
      tasksData = [makeTask({ id: 'n1', text: 'normal', bucket: 'oneoff' })]
      renderList()

      fireEvent.click(screen.getByLabelText('Mark done'))

      expect(markDoneMutate).toHaveBeenCalledWith({
        taskId: 'n1',
        text: 'normal',
        bucket: 'oneoff',
        timeZone: 'UTC',
      })
      // A normal mark-done must NOT touch the recurring/task update path.
      expect(updateMutate).not.toHaveBeenCalled()
    })

    it('marks a RECURRING task done via useUpdateTask with a bumped cycle (no history)', () => {
      tasksData = [
        makeTask({
          id: 'r1',
          text: 'chore',
          recurring: { frequencyDays: 7, lastDoneAt: RECENT, doneCount: 2 },
        }),
      ]
      renderList()

      fireEvent.click(screen.getByLabelText('Mark done (resets clock)'))

      // Recurring done resets the clock: doneCount bumps, lastDoneAt becomes a fresh ISO.
      expect(markDoneMutate).not.toHaveBeenCalled()
      expect(updateMutate).toHaveBeenCalledTimes(1)
      const arg = updateMutate.mock.calls[0]![0] as {
        id: string
        patch: { recurring: { frequencyDays: number; lastDoneAt: string; doneCount: number } }
      }
      expect(arg.id).toBe('r1')
      expect(arg.patch.recurring.frequencyDays).toBe(7)
      expect(arg.patch.recurring.doneCount).toBe(3)
      expect(arg.patch.recurring.lastDoneAt).not.toBe(RECENT)
      expect(Number.isNaN(Date.parse(arg.patch.recurring.lastDoneAt))).toBe(false)
    })
  })

  describe('delete', () => {
    it('soft-deletes only after the confirm dialog is accepted', async () => {
      tasksData = [makeTask({ id: 'del', text: 'delete me' })]
      renderList()

      fireEvent.click(screen.getByLabelText('Delete task'))
      // The app-themed confirm gate appears; nothing is deleted until it's accepted.
      const dialog = await screen.findByRole('dialog')
      expect(deleteMutate).not.toHaveBeenCalled()

      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('del'))
    })

    it('does not delete when the confirm dialog is cancelled', async () => {
      tasksData = [makeTask({ id: 'keep', text: 'keep me' })]
      renderList()

      fireEvent.click(screen.getByLabelText('Delete task'))
      const dialog = await screen.findByRole('dialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      // Dialog dismisses and no soft-delete fires.
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(deleteMutate).not.toHaveBeenCalled()
    })
  })

  describe('recurring section (expanded row)', () => {
    it('Set makes a task recurring via useUpdateTask with a fresh recurring object', () => {
      tasksData = [makeTask({ id: 's1', text: 'make me recurring', recurring: null })]
      renderList()

      fireEvent.click(screen.getByText('make me recurring'))
      fireEvent.change(screen.getByLabelText('Days between repeats'), { target: { value: '7' } })
      fireEvent.click(screen.getByText('Set'))

      expect(updateMutate).toHaveBeenCalledWith({
        id: 's1',
        patch: { recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 } },
      })
    })

    it('Remove clears recurring (recurring: null) via useUpdateTask', () => {
      tasksData = [
        makeTask({
          id: 'rm1',
          text: 'stop repeating',
          recurring: { frequencyDays: 30, lastDoneAt: RECENT, doneCount: 1 },
        }),
      ]
      renderList()

      fireEvent.click(screen.getByText('stop repeating'))
      fireEvent.click(screen.getByText('Remove'))

      expect(updateMutate).toHaveBeenCalledWith({ id: 'rm1', patch: { recurring: null } })
    })

    it('renders the cadence (fmtFrequency) and status label for a recurring task', () => {
      // 7-day cadence done yesterday → "weekly" + an in-Nd "soon"/"ok" status label.
      tasksData = [
        makeTask({
          id: 'f1',
          text: 'weekly chore',
          recurring: { frequencyDays: 7, lastDoneAt: RECENT, doneCount: 1 },
        }),
      ]
      renderList()

      fireEvent.click(screen.getByText('weekly chore'))
      // fmtFrequency(7) === 'weekly'; the recurring section renders the cadence word.
      expect(screen.getAllByText(/weekly/).length).toBeGreaterThan(0)
      // recurringStatus → "in 6d" (daysLeft 6). The label shows in both the collapsed row's
      // status span and the expanded recurring section, so assert at least one is present.
      expect(screen.getAllByText('in 6d').length).toBeGreaterThan(0)
      // The editable frequency input reflects the current cadence.
      expect(screen.getByLabelText('Recurring frequency in days')).toHaveValue(7)
    })

    it('shows the ×N count badge once doneCount >= 3', () => {
      tasksData = [
        makeTask({
          id: 'c1',
          text: 'counted',
          recurring: { frequencyDays: 2, lastDoneAt: RECENT, doneCount: 4 },
        }),
      ]
      renderList()
      expect(screen.getByLabelText('Completed 4 times')).toHaveTextContent('×4')
    })

    it('hides the ×N count badge below doneCount 3', () => {
      tasksData = [
        makeTask({
          id: 'c2',
          text: 'not counted',
          recurring: { frequencyDays: 2, lastDoneAt: RECENT, doneCount: 2 },
        }),
      ]
      renderList()
      expect(screen.queryByLabelText(/Completed/)).not.toBeInTheDocument()
    })
  })
})

// The per-quadrant focus scope behind the mobile overview→focus flow. One placed task per
// quadrant lets us assert that `quadrantFilter` renders exactly its quadrant (split at 0.5,
// boundary on the HIGH side) and nothing else, while leaving the unfiltered list unchanged.
describe('ListView quadrantFilter', () => {
  const quadrantTasks: Task[] = [
    makeTask({ id: 'dn', text: 'do now task', x: 0.9, y: 0.9 }), // urgent + important
    makeTask({ id: 'sc', text: 'schedule task', x: 0.1, y: 0.9 }), // important, not urgent
    makeTask({ id: 'er', text: 'errand task', x: 0.9, y: 0.1 }), // urgent, not important
    makeTask({ id: 'sd', text: 'someday task', x: 0.1, y: 0.1 }), // neither
  ]

  it('renders only tasks in the given quadrant', () => {
    tasksData = quadrantTasks
    renderList({ quadrantFilter: 'schedule' })

    expect(screen.getByText('schedule task')).toBeInTheDocument()
    expect(screen.queryByText('do now task')).not.toBeInTheDocument()
    expect(screen.queryByText('errand task')).not.toBeInTheDocument()
    expect(screen.queryByText('someday task')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('leaves the unfiltered list showing every quadrant (default behavior unchanged)', () => {
    tasksData = quadrantTasks
    renderList()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('ranks within the filtered quadrant by score descending', () => {
    // Two Do Now tasks; the higher-scoring one ranks first WITHIN the quadrant (rank restarts at 1).
    tasksData = [
      makeTask({ id: 'dn-lo', text: 'do now lower', x: 0.55, y: 0.55 }),
      makeTask({ id: 'dn-hi', text: 'do now higher', x: 0.99, y: 0.99 }),
      makeTask({ id: 'sc', text: 'schedule task', x: 0.1, y: 0.9 }),
    ]
    renderList({ quadrantFilter: 'do-now' })

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByText('do now higher')).toBeInTheDocument()
    expect(within(items[0]!).getByLabelText('Rank 1')).toBeInTheDocument()
    expect(within(items[1]!).getByText('do now lower')).toBeInTheDocument()
    expect(within(items[1]!).getByLabelText('Rank 2')).toBeInTheDocument()
  })

  it('excludes staged (unplaced) tasks from a quadrant-scoped view', () => {
    // A staged task has no real quadrant even though its default (0.5, 0.5) would fall in Do Now.
    tasksData = [
      makeTask({ id: 'placed', text: 'placed do-now', x: 0.9, y: 0.9 }),
      makeTask({ id: 'staged', text: 'staged task', x: null, y: null, staged: true }),
    ]
    renderList({ quadrantFilter: 'do-now' })

    expect(screen.getByText('placed do-now')).toBeInTheDocument()
    expect(screen.queryByText('staged task')).not.toBeInTheDocument()
  })

  it('shows a quadrant-scoped empty state when the quadrant has no tasks', () => {
    tasksData = [makeTask({ id: 'dn', text: 'do now task', x: 0.9, y: 0.9 })]
    renderList({ quadrantFilter: 'someday' })

    expect(screen.getByText(/Nothing in this quadrant yet/i)).toBeInTheDocument()
    expect(screen.queryByText('do now task')).not.toBeInTheDocument()
  })
})
