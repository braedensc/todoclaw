import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { Task } from '../../types/task'
import { ListView } from './ListView'
import { quadrantMeta } from '../../lib/quadrants'
import { resolveCollision } from '../../lib/collision'

// Component tests with all data hooks mocked (no Supabase, no network). We assert the
// behavior the list OWNS — ranking order, quadrant coloring, inline-edit + slider commit
// wiring, the staging badge, done-today exclusion, the done control's normal-vs-recurring
// branch, and the recurring set/remove controls. The pure logic itself (taskScore,
// resolveCollision math, recurring thresholds/colors) is covered in src/lib/*.test.ts.

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
    render(<ListView />)

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
    render(<ListView />)

    const color = quadrantMeta(0.9, 0.9).color // Do Now → #bf5e2a
    const rank = screen.getByLabelText('Rank 1')
    expect(rank).toHaveStyle({ color })
    const item = screen.getByRole('listitem')
    expect(item).toHaveStyle({ borderLeft: `4px solid ${color}` })
  })

  it('commits an inline text edit via useUpdateTask', () => {
    tasksData = [makeTask({ id: 'edit-me', text: 'old text' })]
    render(<ListView />)

    fireEvent.click(screen.getByText('old text'))
    const input = screen.getByLabelText('Edit task text')
    fireEvent.change(input, { target: { value: 'new text' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(updateMutate).toHaveBeenCalledWith({ id: 'edit-me', patch: { text: 'new text' } })
  })

  it('runs collision resolution then commits resolved coords on slider commit', () => {
    // Two tasks: target's slider commit must avoid the blocker, so resolveCollision shifts it.
    const blocker = makeTask({ id: 'blocker', text: 'blocker', x: 0.9, y: 0.9 })
    const mover = makeTask({ id: 'mover', text: 'mover', x: 0.1, y: 0.1 })
    tasksData = [blocker, mover]
    render(<ListView />)

    // Expand the mover row (#2) and drag its urgency slider to overlap the blocker.
    const moverRow = screen.getByText('mover').closest('li')!
    fireEvent.click(within(moverRow).getByLabelText('Expand row'))
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

  it('shows a staging badge for staged tasks', () => {
    tasksData = [makeTask({ id: 's', text: 'staged task', staged: true })]
    render(<ListView />)
    expect(screen.getByText('staging')).toBeInTheDocument()
  })

  it('excludes tasks marked done today', () => {
    tasksData = [
      makeTask({ id: 'done', text: 'done today' }),
      makeTask({ id: 'open', text: 'still open' }),
    ]
    doneToday = { done: true }
    render(<ListView />)

    expect(screen.queryByText('done today')).not.toBeInTheDocument()
    expect(screen.getByText('still open')).toBeInTheDocument()
  })

  it('shows the empty state when there are no active tasks', () => {
    tasksData = []
    render(<ListView />)
    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument()
  })

  describe('done control', () => {
    it('marks a NORMAL task done via useMarkTaskDone (not useUpdateTask)', () => {
      tasksData = [makeTask({ id: 'n1', text: 'normal', bucket: 'oneoff' })]
      render(<ListView />)

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
      render(<ListView />)

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

  describe('recurring section (expanded row)', () => {
    it('Set makes a task recurring via useUpdateTask with a fresh recurring object', () => {
      tasksData = [makeTask({ id: 's1', text: 'make me recurring', recurring: null })]
      render(<ListView />)

      fireEvent.click(screen.getByLabelText('Expand row'))
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
      render(<ListView />)

      fireEvent.click(screen.getByLabelText('Expand row'))
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
      render(<ListView />)

      fireEvent.click(screen.getByLabelText('Expand row'))
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
      render(<ListView />)
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
      render(<ListView />)
      expect(screen.queryByLabelText(/Completed/)).not.toBeInTheDocument()
    })
  })
})
