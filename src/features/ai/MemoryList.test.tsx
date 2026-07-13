import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryList } from './MemoryList'
import type { AssistantMemory } from '../../types/assistant-memory'

// Mock the data layer so the panel renders under jsdom with no Supabase; mutations are spies.
const updateMutate = vi.fn()
const deleteMutate = vi.fn()
const deleteAllMutate = vi.fn()
let memoriesData: AssistantMemory[] = []

vi.mock('./use-memories', () => ({
  useMemories: () => ({ data: memoriesData, isLoading: false }),
  useUpdateMemory: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteMemory: () => ({ mutate: deleteMutate, isPending: false }),
  useDeleteAllMemories: () => ({ mutate: deleteAllMutate, isPending: false }),
}))
vi.mock('../../components/use-toast', () => ({ useToast: () => vi.fn() }))

const mem = (over: Partial<AssistantMemory> = {}): AssistantMemory => ({
  id: 'm1',
  content: 'Works out most mornings',
  created_at: '2026-07-01T10:00:00.000Z',
  updated_at: '2026-07-01T10:00:00.000Z',
  ...over,
})

afterEach(() => {
  vi.clearAllMocks()
  memoriesData = []
})

describe('MemoryList', () => {
  it('shows the empty state when nothing is saved', () => {
    render(<MemoryList memoryEnabled onToggleMemory={() => {}} />)
    expect(screen.getByText(/Nothing saved yet/)).toBeInTheDocument()
  })

  it('flips the kill switch through onToggleMemory', () => {
    const onToggle = vi.fn()
    render(<MemoryList memoryEnabled onToggleMemory={onToggle} />)
    fireEvent.click(screen.getByRole('switch', { name: /remember facts/i }))
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('lists a memory and deletes it', () => {
    memoriesData = [mem()]
    render(<MemoryList memoryEnabled onToggleMemory={() => {}} />)
    expect(screen.getByText('Works out most mornings')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete memory' }))
    expect(deleteMutate).toHaveBeenCalledWith('m1', expect.anything())
  })

  it('edits a memory and saves the new text', () => {
    memoriesData = [mem()]
    render(<MemoryList memoryEnabled onToggleMemory={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit memory' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit memory' }), {
      target: { value: 'Works out most evenings' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateMutate).toHaveBeenCalledWith(
      { id: 'm1', content: 'Works out most evenings' },
      expect.anything(),
    )
  })

  it('forgets everything only after the inline confirm', () => {
    memoriesData = [mem()]
    render(<MemoryList memoryEnabled onToggleMemory={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Forget everything' })) // arms the confirm
    expect(deleteAllMutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Forget everything' })) // confirms
    expect(deleteAllMutate).toHaveBeenCalledTimes(1)
  })
})
