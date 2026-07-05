import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfirmProvider } from '../../components/use-confirm'
import type { History } from '../../types/history'

// Mock the data hooks (mirrors how App.test mocks the data layer) so DoneView renders under
// jsdom with no Supabase. Each test overrides the per-hook return below.
const historyMock = vi.fn()
const tasksMock = vi.fn()
const restoreMutate = vi.fn()
const deleteEntryMutate = vi.fn()

vi.mock('./use-history', () => ({
  useHistory: () => historyMock(),
  useRestoreTask: () => ({ mutate: restoreMutate, isPending: false }),
  useDeleteHistoryEntry: () => ({ mutate: deleteEntryMutate, isPending: false }),
}))
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: { timezone: 'America/New_York' } }),
}))
vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => tasksMock(),
}))

import { DoneView } from './DoneView'

// DoneView calls useConfirm() on every render, so it must be wrapped in a ConfirmProvider.
function renderView() {
  return render(
    <ConfirmProvider>
      <DoneView />
    </ConfirmProvider>,
  )
}

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
  // The default entry's task (t1) is live, so Restore is offered. Tests that need the task to
  // be gone (soft-deleted) override this with an empty list.
  tasksMock.mockReturnValue({ data: [{ id: 't1', x: 0.75, y: 0.25, due: null, recurring: null }] })
})

describe('DoneView', () => {
  it('shows the empty state when there is no history', () => {
    historyMock.mockReturnValue({ data: [], isLoading: false, isError: false })
    renderView()
    expect(screen.getByText(/Nothing done yet/i)).toBeInTheDocument()
  })

  it('renders a history row with its text', () => {
    historyMock.mockReturnValue({ data: [entry()], isLoading: false, isError: false })
    renderView()
    expect(screen.getByText('Ship PR6')).toBeInTheDocument()
  })

  it('shows the mini-card quadrant label from the live task’s x/y', () => {
    historyMock.mockReturnValue({ data: [entry()], isLoading: false, isError: false })
    renderView()
    // t1 sits at (0.75, 0.25): x>=0.5, y<0.5 → Errands.
    expect(screen.getByText('Errands')).toBeInTheDocument()
  })

  it('offers Restore for any completion whose task still exists and calls useRestoreTask', () => {
    historyMock.mockReturnValue({ data: [entry()], isLoading: false, isError: false })
    renderView()
    const restore = screen.getByRole('button', { name: /Restore/i })
    fireEvent.click(restore)
    expect(restoreMutate).toHaveBeenCalledWith({ taskId: 't1', timeZone: 'America/New_York' })
  })

  it('hides Restore when the underlying task has been soft-deleted (absent from live tasks)', () => {
    // set_task_undone can't bring back a soft-deleted task, so Restore would be a silent no-op.
    // Once the task drops out of the live set, the button must not render.
    historyMock.mockReturnValue({ data: [entry()], isLoading: false, isError: false })
    tasksMock.mockReturnValue({ data: [] })
    renderView()
    expect(screen.queryByRole('button', { name: /Restore/i })).not.toBeInTheDocument()
  })

  it('deletes the completion RECORD (not the task) only after confirming in the dialog', async () => {
    historyMock.mockReturnValue({ data: [entry()], isLoading: false, isError: false })
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /Delete "Ship PR6"/i }))
    // The themed confirm dialog appears; deletion fires only after its Delete button is clicked.
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/ }))
    await waitFor(() => expect(deleteEntryMutate).toHaveBeenCalledWith('h1'))
  })

  it('offers Delete even when the underlying task is gone (record removal is independent)', () => {
    historyMock.mockReturnValue({
      data: [entry({ task_id: null })],
      isLoading: false,
      isError: false,
    })
    tasksMock.mockReturnValue({ data: [] })
    renderView()
    expect(screen.getByRole('button', { name: /Delete "Ship PR6"/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Restore/i })).not.toBeInTheDocument()
  })

  it('does NOT delete when the confirm dialog is cancelled', async () => {
    historyMock.mockReturnValue({ data: [entry()], isLoading: false, isError: false })
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /Delete "Ship PR6"/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteEntryMutate).not.toHaveBeenCalled()
  })
})
