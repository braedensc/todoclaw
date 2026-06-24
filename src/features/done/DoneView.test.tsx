import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { History } from '../../types/history'

// Mock the data hooks (mirrors how App.test mocks the data layer) so DoneView renders under
// jsdom with no Supabase. Each test overrides the per-hook return below.
const historyMock = vi.fn()
const dailyMock = vi.fn()
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
