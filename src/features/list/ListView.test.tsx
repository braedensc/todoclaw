import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { Task } from '../../types/task'
import { ListView } from './ListView'
import { quadrantMeta } from '../../lib/quadrants'
import { resolveCollision } from '../../lib/collision'

// Component tests with all data hooks mocked (no Supabase, no network). We assert the
// behavior the list OWNS — ranking order, quadrant coloring, inline-edit + slider commit
// wiring, the staging badge, and done-today exclusion. The pure logic itself (taskScore,
// resolveCollision math) is covered in src/lib/*.test.ts, so we don't re-test it here.

const updateMutate = vi.fn()
const deleteMutate = vi.fn()
let tasksData: Task[] = []
let doneToday: Record<string, true> = {}

vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => ({ data: tasksData, isLoading: false, isError: false }),
  useUpdateTask: () => ({ mutate: updateMutate }),
  useSoftDeleteTask: () => ({ mutate: deleteMutate }),
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
  tasksData = []
  doneToday = {}
})

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
})
