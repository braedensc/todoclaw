import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ChatSession, ChatPreview } from '../../types/chat'
import type { InboxMessage } from '../notifications/use-messages'

// Mock the data layer + toast so the unified list renders without Supabase / a QueryClientProvider.
let sessions: ChatSession[] = []
let messages: InboxMessage[] = []
let previews: ChatPreview[] = []
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
vi.mock('./use-chat-previews', () => ({ useChatPreviews: () => ({ data: previews }) }))
vi.mock('../../components/use-toast', () => ({ useToast: () => toast }))

import { ChatSessionList } from './ChatSessionList'

// A preview row as chat_list_previews returns it: BabyClaw's turn unless `words` is given, in which
// case it's the person's. `count` is USER-VISIBLE messages (the RPC drops the hidden framing turn).
const p = (session_id: string, text: string, count: number, words?: 'typed'): ChatPreview =>
  words
    ? { session_id, msg_count: count, last_role: 'user', last_content: text, last_meta: null }
    : {
        session_id,
        msg_count: count,
        last_role: 'assistant',
        last_content: [{ type: 'text', text }],
        last_meta: null,
      }

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
  local_date: origin === 'proactive' ? '2026-07-14' : null,
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
  previews = []
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
    expect(screen.getByText(/morning plan/i)).toBeInTheDocument()
    expect(screen.getByText('Plan my week')).toBeInTheDocument()
    expect(screen.getByText('Untitled chat')).toBeInTheDocument()
  })

  it('day-stamps a plan/recap so it is clear which day it is', () => {
    messages = [m('m1', { kind: 'plan', local_date: '2026-07-14' })]
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    // Every weekday ends in "day", so this asserts the format "<Weekday> morning plan".
    expect(screen.getByText(/^\w+day morning plan$/i)).toBeInTheDocument()
    // The generic stored title is replaced by the day-stamped one.
    expect(screen.queryByText('Your morning plan')).toBeNull()
  })

  it('shows "You started" above "From BabyClaw"', () => {
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    const mine = screen.getByText('You started')
    const his = screen.getByText('From BabyClaw')
    // Sibling group labels: his follows mine in document order → "You started" renders first.
    expect(mine.compareDocumentPosition(his)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('caps "From BabyClaw" to the 3 most recent messages', () => {
    // Reminders keep their own titles (no day-stamp), so they stay distinguishable for this count.
    messages = ['A', 'B', 'C', 'D', 'E'].map((t, i) =>
      m(`m${i}`, { kind: 'reminder', title: `Task ${t}` }),
    )
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    for (const t of ['Task A', 'Task B', 'Task C']) {
      expect(screen.getByText(t)).toBeInTheDocument()
    }
    expect(screen.queryByText('Task D')).toBeNull()
    expect(screen.queryByText('Task E')).toBeNull()
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
    fireEvent.click(screen.getByText(/morning plan/i))
    expect(markReadMutate).toHaveBeenCalledWith('m1')
    expect(openMsgMutate).toHaveBeenCalledWith('m1', expect.any(Object))
    expect(onOpen).toHaveBeenCalledWith('sess-new')
  })

  it('an already-opened, already-read message jumps straight to its session (no re-open / re-mark)', () => {
    const onOpen = vi.fn()
    messages = [m('m1', { session_id: 'sess-1', read_at: new Date().toISOString() })]
    render(<ChatSessionList currentId={null} onOpen={onOpen} onNew={vi.fn()} />)
    fireEvent.click(screen.getByText(/morning plan/i))
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

  describe('last-message preview', () => {
    it('shows a snippet of the last message under a chat`s name', () => {
      previews = [p('a', 'Moved taxes to Friday.', 4)]
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.getByText('Moved taxes to Friday.')).toBeInTheDocument()
    })

    it('attributes your own last words with "You:"', () => {
      previews = [p('a', 'move taxes to friday', 4, 'typed')]
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.getByText('You: move taxes to friday')).toBeInTheDocument()
    })

    it('renders name + time only while previews are still loading (no empty snippet line)', () => {
      previews = []
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.getByText('Plan my week')).toBeInTheDocument()
    })

    it("previews an unopened check-in with the check-in's own text", () => {
      messages = [m('m1', { body: '1. Ship the deck\n2. Call the vet' })]
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      // Flattened to one line — a stored body is multi-line prose.
      expect(screen.getByText('1. Ship the deck 2. Call the vet')).toBeInTheDocument()
    })

    it('previews an OPENED check-in from where the conversation actually got to', () => {
      messages = [m('m1', { session_id: 'sess-1', body: '1. Ship the deck' })]
      previews = [p('sess-1', 'Done — moved it to Friday.', 3)]
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.getByText('Done — moved it to Friday.')).toBeInTheDocument()
      expect(screen.queryByText('1. Ship the deck')).toBeNull()
    })
  })

  describe('reply badge on BabyClaw`s check-ins', () => {
    it('badges a check-in you have replied to with its message count', () => {
      messages = [m('m1', { session_id: 'sess-1' })]
      previews = [p('sess-1', 'Anything else?', 3)]
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.getByLabelText('3 messages')).toHaveTextContent('3')
    })

    // The hidden-framing-turn gotcha, at the UI boundary: an opened-but-unanswered check-in holds ONE
    // visible message, so it must read as untouched. A raw count(*) would say 2 and badge it.
    it('does NOT badge a check-in you only received (one visible message)', () => {
      messages = [m('m1', { session_id: 'sess-1' })]
      previews = [p('sess-1', 'Morning! Three things today.', 1)]
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.queryByLabelText(/messages$/)).toBeNull()
    })

    it('does NOT badge a check-in that was never opened', () => {
      messages = [m('m1', { session_id: null })]
      previews = []
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.queryByLabelText(/messages$/)).toBeNull()
    })

    it('leaves your own chats unbadged — those are used by definition', () => {
      previews = [p('a', 'Sure thing.', 6)]
      messages = []
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.getByText('Sure thing.')).toBeInTheDocument()
      expect(screen.queryByLabelText(/messages$/)).toBeNull()
    })
  })
})
