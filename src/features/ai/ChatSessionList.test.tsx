import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ChatSession } from '../../types/chat'

// Mock the data layer + toast so the list is testable without Supabase / a QueryClientProvider.
let sessions: ChatSession[] = []
const deleteMutate =
  vi.fn<(id: string, opts?: { onSuccess?: () => void; onError?: () => void }) => void>()
const toast = vi.fn()

vi.mock('./use-chat-sessions', () => ({
  useChatSessions: () => ({ data: sessions, isLoading: false }),
  useDeleteChatSession: () => ({ mutate: deleteMutate }),
}))
vi.mock('../../components/use-toast', () => ({ useToast: () => toast }))

import { ChatSessionList } from './ChatSessionList'

const s = (id: string, title: string | null): ChatSession => ({
  id,
  title,
  updated_at: new Date().toISOString(),
  pending: null,
})

beforeEach(() => {
  sessions = [s('a', 'Plan my week'), s('b', null)]
  deleteMutate.mockReset()
  toast.mockReset()
})

describe('ChatSessionList', () => {
  it('lists saved conversations (untitled fallback) and marks the current one', () => {
    render(<ChatSessionList currentId="a" onOpen={vi.fn()} onNew={vi.fn()} />)
    expect(screen.getByText('Plan my week')).toBeInTheDocument()
    expect(screen.getByText('Untitled chat')).toBeInTheDocument()
  })

  it('opens a session on click and starts a new chat via the button', () => {
    const onOpen = vi.fn()
    const onNew = vi.fn()
    render(<ChatSessionList currentId={null} onOpen={onOpen} onNew={onNew} />)
    fireEvent.click(screen.getByText('Plan my week'))
    expect(onOpen).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))
    expect(onNew).toHaveBeenCalled()
  })

  it('empty state when there are no conversations', () => {
    sessions = []
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    expect(screen.getByText(/no saved conversations/i)).toBeInTheDocument()
  })

  it('deletes only after a second confirm click', () => {
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Plan my week' })) // the ✕
    expect(deleteMutate).not.toHaveBeenCalled() // just armed the confirm
    fireEvent.click(screen.getByRole('button', { name: 'Delete' })) // the confirm
    expect(deleteMutate).toHaveBeenCalledWith('a', expect.any(Object))
  })

  it('resets to a new chat when the CURRENTLY-open session is deleted', () => {
    const onNew = vi.fn()
    deleteMutate.mockImplementation((_id, opts) => opts?.onSuccess?.())
    render(<ChatSessionList currentId="a" onOpen={vi.fn()} onNew={onNew} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Plan my week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onNew).toHaveBeenCalled()
  })

  it('toasts on a delete failure', () => {
    deleteMutate.mockImplementation((_id, opts) => opts?.onError?.())
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Plan my week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/couldn.t delete/i), 'error')
  })
})
