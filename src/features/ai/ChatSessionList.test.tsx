import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ChatSession } from '../../types/chat'
import type { InboxMessage } from '../notifications/use-messages'

// Mock the data layer + toast so the unified list renders without Supabase / a QueryClientProvider.
let sessions: ChatSession[] = []
let messages: InboxMessage[] = []
const deleteMutate =
  vi.fn<(id: string, opts?: { onSuccess?: () => void; onError?: () => void }) => void>()
const openMsgMutate =
  vi.fn<(id: string, opts?: { onSuccess?: (sid: string) => void; onError?: () => void }) => void>()
const markReadMutate = vi.fn<(id: string) => void>()
const toast = vi.fn()

vi.mock('./use-chat-sessions', () => ({
  useChatSessions: () => ({ data: sessions, isLoading: false }),
  useDeleteChatSession: () => ({ mutate: deleteMutate }),
}))
vi.mock('../notifications/use-messages', () => ({
  useMessages: () => ({ data: messages, isLoading: false }),
  useMarkMessageRead: () => ({ mutate: markReadMutate }),
  useOpenMessageChat: () => ({ mutate: openMsgMutate }),
}))
vi.mock('../../components/use-toast', () => ({ useToast: () => toast }))

import { ChatSessionList } from './ChatSessionList'

const s = (
  id: string,
  title: string | null,
  origin: 'user' | 'proactive' = 'user',
): ChatSession => ({
  id,
  title,
  updated_at: new Date().toISOString(),
  origin,
  kind: origin === 'proactive' ? 'plan' : null,
  pending: null,
})

const m = (id: string, over: Partial<InboxMessage> = {}): InboxMessage => ({
  id,
  kind: 'plan',
  local_date: '2026-07-14',
  title: 'Your morning plan',
  body: '1. Ship the deck',
  read_at: null,
  created_at: new Date().toISOString(),
  session_id: null,
  ...over,
})

beforeEach(() => {
  sessions = [s('a', 'Plan my week'), s('b', null)]
  messages = [m('m1')]
  deleteMutate.mockReset()
  openMsgMutate.mockReset()
  markReadMutate.mockReset()
  toast.mockReset()
})

describe('ChatSessionList (unified inbox + chats)', () => {
  it('shows both groups: proactive messages under "From BabyClaw", your chats under "You started"', () => {
    render(<ChatSessionList currentId="a" onOpen={vi.fn()} onNew={vi.fn()} />)
    expect(screen.getByText('From BabyClaw')).toBeInTheDocument()
    expect(screen.getByText('You started')).toBeInTheDocument()
    expect(screen.getByText('Your morning plan')).toBeInTheDocument()
    expect(screen.getByText('Plan my week')).toBeInTheDocument()
    expect(screen.getByText('Untitled chat')).toBeInTheDocument()
  })

  it('shows "You started" above "From BabyClaw"', () => {
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    const mine = screen.getByText('You started')
    const his = screen.getByText('From BabyClaw')
    // Sibling group labels: his follows mine in document order → "You started" renders first.
    expect(mine.compareDocumentPosition(his)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('caps "From BabyClaw" to the 3 most recent messages', () => {
    messages = ['A', 'B', 'C', 'D', 'E'].map((t, i) => m(`m${i}`, { title: `Plan ${t}` }))
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    for (const t of ['Plan A', 'Plan B', 'Plan C']) {
      expect(screen.getByText(t)).toBeInTheDocument()
    }
    expect(screen.queryByText('Plan D')).toBeNull()
    expect(screen.queryByText('Plan E')).toBeNull()
  })

  it('opens a user session on click and starts a new chat via the button', () => {
    const onOpen = vi.fn()
    const onNew = vi.fn()
    render(<ChatSessionList currentId={null} onOpen={onOpen} onNew={onNew} />)
    fireEvent.click(screen.getByText('Plan my week'))
    expect(onOpen).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))
    expect(onNew).toHaveBeenCalled()
  })

  it('opening an unread message marks it read, materialises its session, then opens it', () => {
    const onOpen = vi.fn()
    openMsgMutate.mockImplementation((_id, opts) => opts?.onSuccess?.('sess-new'))
    render(<ChatSessionList currentId={null} onOpen={onOpen} onNew={vi.fn()} />)
    fireEvent.click(screen.getByText('Your morning plan'))
    expect(markReadMutate).toHaveBeenCalledWith('m1')
    expect(openMsgMutate).toHaveBeenCalledWith('m1', expect.any(Object))
    expect(onOpen).toHaveBeenCalledWith('sess-new')
  })

  it('an already-opened, already-read message jumps straight to its session (no re-open / re-mark)', () => {
    const onOpen = vi.fn()
    messages = [m('m1', { session_id: 'sess-1', read_at: new Date().toISOString() })]
    render(<ChatSessionList currentId={null} onOpen={onOpen} onNew={vi.fn()} />)
    fireEvent.click(screen.getByText('Your morning plan'))
    expect(onOpen).toHaveBeenCalledWith('sess-1')
    expect(openMsgMutate).not.toHaveBeenCalled()
    expect(markReadMutate).not.toHaveBeenCalled()
  })

  it('does NOT list a proactive session (it is represented by its message row, not duplicated)', () => {
    sessions = [s('p', 'Morning plan', 'proactive')]
    messages = []
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    expect(screen.queryByText('You started')).toBeNull()
    expect(screen.getByText(/no chats yet/i)).toBeInTheDocument()
  })

  it('empty state when there are no messages and no chats', () => {
    sessions = []
    messages = []
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    expect(screen.getByText(/no chats yet/i)).toBeInTheDocument()
  })

  it('deletes a chat only after a second confirm click', () => {
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
