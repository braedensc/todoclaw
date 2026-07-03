import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { BackupsPanel } from './BackupsPanel'
import type { Backup } from '../../types/backup'

// Mock the data layer so the panel renders under jsdom with no Supabase. Mutations are spies.
const createMutate = vi.fn()
const restoreMutate = vi.fn()
let backupsData: Backup[] = []

vi.mock('./use-backups', () => ({
  useBackups: () => ({ data: backupsData, isLoading: false }),
  useCreateBackup: () => ({ mutate: createMutate, isPending: false, isError: false }),
  useRestoreBackup: () => ({ mutate: restoreMutate, isPending: false, isError: false }),
}))
vi.mock('../tasks/use-tasks', () => ({ useTasks: () => ({ data: [] }) }))
vi.mock('../habits/use-habits', () => ({ useHabits: () => ({ data: [] }) }))

afterEach(() => {
  vi.clearAllMocks()
  backupsData = []
})

describe('BackupsPanel', () => {
  it('shows the empty state when there are no backups', () => {
    render(<BackupsPanel onClose={() => {}} />)
    expect(screen.getByText('No backups yet — create one above.')).toBeInTheDocument()
  })

  it('creates a backup on click', () => {
    render(<BackupsPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }))
    expect(createMutate).toHaveBeenCalledTimes(1)
  })

  it('lists a backup and restores it after the user confirms', () => {
    backupsData = [{ id: 'b1', label: null, created_at: '2026-07-01T10:00:00.000Z' }]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<BackupsPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Restore backup from/ }))
    expect(restoreMutate).toHaveBeenCalledWith('b1')
    confirmSpy.mockRestore()
  })

  it('does not restore when the confirm is dismissed', () => {
    backupsData = [{ id: 'b1', label: null, created_at: '2026-07-01T10:00:00.000Z' }]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<BackupsPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Restore backup from/ }))
    expect(restoreMutate).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
