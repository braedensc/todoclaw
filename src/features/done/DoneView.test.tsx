import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { History } from '../../types/history'

// Mock the data hooks (mirrors how App.test mocks the data layer) so DoneView renders under
// jsdom with no Supabase. Each test overrides the per-hook return below.
const historyMock = vi.fn()
const dailyMock = vi.fn()
const tasksMock = vi.fn()
const restoreMutate = vi.fn()
const softDeleteMutate = vi.fn()

vi.mock('./use-history', () => ({
  useHistory: () => historyMock(),
  useRestoreTask: () => ({ mutate: restoreMutate, isPending: false }),
}))
vi.mock('../daily-state/use-daily-state', () => ({
  useDailyState: () => dailyMock(),
}))
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: { timezone: 'America/New_York' } }),
}))
vi.mock('../tasks/use-tasks', () => ({
  useSoftDeleteTask: () => ({ mutate: softDeleteMutate, isPending: false }),
  useTasks: () => tasksMock(),
}))

import { DoneView } from './DoneView'

function entry(over: Partial<History> = {}): History {
  return {
    id: 'h1',
    user_id: 'u1',
    task_id: 't1',
    text: 'Ship PR6',
    bucket: 'oneoff',
    completed_at: '2026-06-23T16:18:00.000Z',
    created_at: '2026-06-23T16:18:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  dailyMock.mockReturnValue({ data: { done: {}, done_at: {}, habit_done: {}, subtask_done: {} } })
  // The default entry's task (t1) is live, so the live-set gate is a no-op for the existing
  // Restore assertions. The soft-delete regression test overrides this with an empty list.
  tasksMock.mockReturnValue({ data: [{ id: 't1' }] })
})

describe('DoneView', () => {
  it('shows the empty state when there is no history', () => {
    historyMock.mockReturnValue({ data: [], isLoading: false, isError: false })
    render(<DoneView />)
    expect(screen.getByText(/Nothing done yet/i)).toBeInTheDocument()
  })

  it('renders a history row with its text', () => {
    historyMock.mockReturnValue({ data: [entry()], isLoading: false, isError: false })
    render(<DoneView />)
    expect(screen.getByText('Ship PR6')).toBeInTheDocument()
  })

  it('hides Restore when the task is NOT in today’s done map', () => {
    historyMock.mockReturnValue({ data: [entry()], isLoading: false, isError: false })
    dailyMock.mockReturnValue({ data: { done: {}, done_at: {}, habit_done: {}, subtask_done: {} } })
    render(<DoneView />)
    expect(screen.queryByRole('button', { name: /Restore/i })).not.toBeInTheDocument()
  })

  it('shows Restore and calls useRestoreTask when the task IS in today’s done map', async () => {
    historyMock.mockReturnValue({ data: [entry()], isLoading: false, isError: false })
    dailyMock.mockReturnValue({
      data: { done: { t1: true }, done_at: {}, habit_done: {}, subtask_done: {} },
    })
    render(<DoneView />)
    const restore = screen.getByRole('button', { name: /Restore/i })
    fireEvent.click(restore)
    expect(restoreMutate).toHaveBeenCalledWith({ taskId: 't1', timeZone: 'America/New_York' })
  })

  it('hides Restore when the done task has been soft-deleted (absent from live tasks)', () => {
    // Regression: a task soft-deleted while still marked done today keeps its history row and
    // its done[id]=true, but set_task_undone never clears deleted_at — so Restore would be a
    // silent no-op. Once the task drops out of the live set, the button must not render.
    historyMock.mockReturnValue({ data: [entry()], isLoading: false, isError: false })
    dailyMock.mockReturnValue({
      data: { done: { t1: true }, done_at: {}, habit_done: {}, subtask_done: {} },
    })
    tasksMock.mockReturnValue({ data: [] }) // t1 was soft-deleted → absent from live tasks
    render(<DoneView />)
    expect(screen.queryByRole('button', { name: /Restore/i })).not.toBeInTheDocument()
  })

  it('soft-deletes the task only after confirm; history row persists conceptually', async () => {
    historyMock.mockReturnValue({ data: [entry()], isLoading: false, isError: false })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DoneView />)
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(softDeleteMutate).toHaveBeenCalledWith('t1')
    confirmSpy.mockRestore()
  })

  it('does NOT delete when the confirm is dismissed', async () => {
    historyMock.mockReturnValue({ data: [entry()], isLoading: false, isError: false })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<DoneView />)
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }))
    expect(softDeleteMutate).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
