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

  it('caps "From BabyClaw" to the 5 most recent READ check-ins, and says so when it hides any', () => {
    // Reminders keep their own titles (no day-stamp), so they stay distinguishable for this count.
    // All READ — the cap trims only read history; an UNREAD one would be exempt (next test).
    // Timestamps must be explicit and distinct (A newest → G oldest): the cap sorts by recency, and
    // same-millisecond ties from a bare new Date() made survival depend on a mid-loop clock tick.
    const read = new Date().toISOString()
    messages = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((t, i) =>
      m(`m${i}`, {
        kind: 'reminder',
        title: `Task ${t}`,
        created_at: new Date(Date.now() - i * 60_000).toISOString(),
        read_at: read,
      }),
    )
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    for (const t of ['Task A', 'Task B', 'Task C', 'Task D', 'Task E']) {
      expect(screen.getByText(t)).toBeInTheDocument()
    }
    expect(screen.queryByText('Task F')).toBeNull()
    expect(screen.queryByText('Task G')).toBeNull()
    // The note explains the two that are missing — and promises only what's true: they're not
    // SHOWN. Nothing deletes a check-in, so it must never claim they aren't stored.
    expect(screen.getByText(/nothing.s deleted/i)).toBeInTheDocument()
  })

  it('no note when nothing is hidden — there is nothing to explain', () => {
    messages = ['A', 'B'].map((t, i) => m(`m${i}`, { kind: 'reminder', title: `Task ${t}` }))
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    expect(screen.getByText('Task A')).toBeInTheDocument()
    expect(screen.queryByText(/tucked away/i)).toBeNull()
  })

  it('keeps every UNREAD check-in visible past the cap — the badge counts them all, so none may hide', () => {
    // The nav "Chat N" badge counts every unread message; if the cap could bury an unread check-in,
    // the badge would claim more than the list shows (the "Chat 3 but nothing new" mismatch this
    // fixes). Five recent READ check-ins fill the cap; three OLDER UNREAD ones must still each show.
    const read = new Date().toISOString()
    const readMsgs = ['A', 'B', 'C', 'D', 'E'].map((t, i) =>
      m(`r${i}`, {
        kind: 'reminder',
        title: `Read ${t}`,
        created_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
        read_at: read,
      }),
    )
    const unreadMsgs = ['X', 'Y', 'Z'].map((t, i) =>
      m(`u${i}`, {
        kind: 'reminder',
        title: `Unread ${t}`,
        created_at: new Date(Date.now() - (i + 10) * 3_600_000).toISOString(),
      }),
    )
    messages = [...readMsgs, ...unreadMsgs]
    render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
    for (const t of ['Unread X', 'Unread Y', 'Unread Z']) {
      expect(screen.getByText(t)).toBeInTheDocument()
    }
    // One unread dot per unread message — exactly what useUnreadCount sums for the nav badge.
    expect(screen.getAllByLabelText('unread')).toHaveLength(3)
  })

  describe('ranking BabyClaw check-ins by last message', () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
    const proactive = (id: string, updated_at: string): ChatSession => ({
      ...s(id, null, 'proactive'),
      updated_at,
    })
    const check = (
      id: string,
      title: string,
      created_at: string,
      session_id: string | null = null,
      read_at: string | null = null,
    ) => m(id, { kind: 'reminder', title, created_at, session_id, read_at })

    it('ranks a check-in by its LAST message, not when BabyClaw sent it', () => {
      // "Task Old" arrived 3 days ago but you replied to it a minute ago; "Task New" arrived this
      // morning and has sat untouched. The live conversation belongs on top.
      messages = [
        check('m-new', 'Task New', hoursAgo(2)),
        check('m-old', 'Task Old', hoursAgo(72), 'sess-old'),
      ]
      sessions = [proactive('sess-old', hoursAgo(0))]
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.getAllByText(/^Task /).map((e) => e.textContent)).toEqual([
        'Task Old',
        'Task New',
      ])
    })

    it('the cap keeps the most recently ACTIVE check-ins, not the most recently arrived', () => {
      // Sorting has to run BEFORE the cap: F arrived last of the six, but you're mid-reply in it,
      // so it must survive and push the stalest one (E) out. Six rows for a cap of five — enough
      // that the cap actually bites, so this can't quietly stop testing it. All READ, so the cap
      // governs them (unread check-ins are exempt — see the "keeps every UNREAD" test above).
      const read = new Date().toISOString()
      messages = ['A', 'B', 'C', 'D', 'E', 'F'].map((t, i) =>
        check(`m${i}`, `Task ${t}`, hoursAgo(i + 1), null, read),
      )
      messages[5] = check('m5', 'Task F', hoursAgo(6), 'sess-f', read)
      sessions = [proactive('sess-f', hoursAgo(0))]
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.getAllByText(/^Task /).map((e) => e.textContent)).toEqual([
        'Task F',
        'Task A',
        'Task B',
        'Task C',
        'Task D',
      ])
      expect(screen.queryByText('Task E')).toBeNull()
    })

    it("stamps a check-in with its last message's time, not its arrival", () => {
      messages = [check('m1', 'Task X', hoursAgo(72), 'sess-x')]
      sessions = [proactive('sess-x', hoursAgo(0))]
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.getByText(/Reminder · just now/)).toBeInTheDocument()
      expect(screen.queryByText(/3d ago/)).toBeNull()
    })

    it('an unopened check-in still ranks on its arrival — that IS its last message', () => {
      messages = [check('m-a', 'Task A', hoursAgo(5)), check('m-b', 'Task B', hoursAgo(1))]
      sessions = []
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.getAllByText(/^Task /).map((e) => e.textContent)).toEqual(['Task B', 'Task A'])
    })
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

    // The tint is the at-a-glance half of the signal (the badge only reads row by row), so it gets
    // asserted on the row's own class — there is no other observable for a purely visual state. The
    // bell's bg-puppy/10 is on a CHILD span, so it can't satisfy these.
    it('tints the row of a check-in you have replied to', () => {
      messages = [m('m1', { session_id: 'sess-1' })]
      previews = [p('sess-1', 'Anything else?', 3)]
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.getByRole('button', { name: /morning plan/i }).className).toMatch(/bg-puppy/)
    })

    it('does NOT tint a check-in you only received', () => {
      messages = [m('m1', { session_id: 'sess-1' })]
      previews = [p('sess-1', 'Morning! Three things today.', 1)]
      render(<ChatSessionList currentId={null} onOpen={vi.fn()} onNew={vi.fn()} />)
      expect(screen.getByRole('button', { name: /morning plan/i }).className).not.toMatch(
        /bg-puppy/,
      )
    })

    it('the open conversation keeps its own background rather than stacking the tint', () => {
      messages = [m('m1', { session_id: 'sess-1' })]
      previews = [p('sess-1', 'Anything else?', 3)]
      render(<ChatSessionList currentId="sess-1" onOpen={vi.fn()} onNew={vi.fn()} />)
      const row = screen.getByRole('button', { name: /morning plan/i })
      expect(row.className).toMatch(/bg-card/)
      expect(row.className).not.toMatch(/bg-puppy/)
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
