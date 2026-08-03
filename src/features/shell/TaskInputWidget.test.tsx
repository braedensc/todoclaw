import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

// The widget pulls in use-tasks (→ src/lib/supabase, which THROWS at import without env vars —
// CI runs with none). Stub the client module itself so every transitive importer is satisfied.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import { TaskInputWidget } from './TaskInputWidget'
import type { ChatController } from '../ai/use-chat-controller'
import type { GridApi } from '../grid/use-grid'
import type { ChatItem } from '../ai/use-ai-chat'

// The widget's identity + waiting-state layer. The status derivation itself is covered in
// babyclaw-status.test.ts; here we assert the visible contract: the Task Manager title, the
// always-attributed BabyClaw line, and the unmissable "waiting on your reply" strip (with
// working inline Yes/No for confirmations, and the attention dot when Manual mode hides it).
//
// Default mode is BabyClaw, which never touches the grid API — a minimal stub keeps the test
// off useGrid's drag machinery (Manual mode's add path is exercised by the golden E2E suite).

const gridStub = { pendingTasks: [] } as unknown as GridApi

function chatStub(over: Partial<ChatController> = {}): ChatController {
  return {
    items: [] as ChatItem[],
    liveItems: [] as ChatItem[],
    busy: false,
    pending: null,
    error: null,
    paused: false,
    sessionId: null,
    activeSession: null,
    send: vi.fn(),
    confirm: vi.fn(),
    deny: vi.fn(),
    seed: vi.fn(),
    openSession: vi.fn(),
    newChat: vi.fn(),
    ...over,
  } as ChatController
}

function renderWidget(chat: ChatController, onOpenChat = vi.fn()) {
  // Manual mode mounts useAddTask (a TanStack mutation), so the tree needs a QueryClient.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TaskInputWidget grid={gridStub} chat={chat} canPlace onOpenChat={onOpenChat} />
    </QueryClientProvider>,
  )
  return onOpenChat
}

describe('TaskInputWidget', () => {
  it('names itself Task Manager and signs the idle line as BabyClaw', () => {
    renderWidget(chatStub())
    expect(screen.getByRole('region', { name: 'Task manager' })).toBeInTheDocument()
    expect(screen.getByText('Task Manager')).toBeInTheDocument()
    // "BabyClaw" appears twice: his mode tab AND the status line's signature.
    expect(screen.getAllByText('BabyClaw')).toHaveLength(2)
    expect(screen.getByText(/plain language/i)).toBeInTheDocument()
  })

  it('keeps "Open chat" under the mode toggle and wires it to the drawer', () => {
    const onOpenChat = renderWidget(chatStub())
    fireEvent.click(screen.getByRole('button', { name: /Open chat/ }))
    expect(onOpenChat).toHaveBeenCalledOnce()
  })

  it('"Open chat" from an EMPTY widget starts a new chat, not the resumed one', () => {
    // The controller auto-resumes the newest < 24h session at mount, so sessionId is already set
    // even though the widget itself is untouched. Opening from here must re-anchor to a fresh chat
    // rather than surface last night's history.
    const newChat = vi.fn()
    const onOpenChat = renderWidget(chatStub({ sessionId: 'resumed-session', newChat }))
    fireEvent.click(screen.getByRole('button', { name: /Open chat/ }))
    expect(newChat).toHaveBeenCalledOnce()
    expect(onOpenChat).toHaveBeenCalledOnce()
  })

  it('"Open chat" mid-conversation keeps the session the widget is talking to', () => {
    const newChat = vi.fn()
    const onOpenChat = renderWidget(
      chatStub({
        sessionId: 's1',
        newChat,
        liveItems: [
          { id: 'u1', role: 'user', text: 'add groceries' },
          { id: 'a1', role: 'assistant', text: 'Added it.' },
        ],
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Open chat/ }))
    expect(newChat).not.toHaveBeenCalled()
    expect(onOpenChat).toHaveBeenCalledOnce()
  })

  it('a restored confirmation counts as live — opening must not wipe the question', () => {
    // A pending confirmation is rehydrated from the resumed session row and has NO liveItems of its
    // own. Treating "no liveItems" as empty would reset the chat the strip is pointing the user at.
    const newChat = vi.fn()
    renderWidget(
      chatStub({
        sessionId: 's1',
        newChat,
        pending: { toolUseId: 't1', summary: 'Delete "old draft"' },
        liveItems: [],
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'open the full chat' }))
    expect(newChat).not.toHaveBeenCalled()
  })

  it('a pending confirmation shows the waiting strip with working Yes/No buttons', () => {
    const confirm = vi.fn()
    const deny = vi.fn()
    renderWidget(
      chatStub({ pending: { toolUseId: 't1', summary: 'Delete "old draft"' }, confirm, deny }),
    )
    expect(screen.getByText(/waiting on your reply/i)).toBeInTheDocument()
    expect(screen.getByText(/Delete "old draft"/)).toBeInTheDocument()
    expect(screen.getByText(/won’t do anything until you answer/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Yes, go ahead' }))
    expect(confirm).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(deny).toHaveBeenCalledOnce()
  })

  it('a question from BabyClaw shows the waiting strip without confirm buttons, linking the full chat', () => {
    // The status/flash read THIS visit's liveItems (not hydrated history) — a cold resume of an old
    // question must NOT read as "waiting", so a live question here is what surfaces the strip.
    const onOpenChat = renderWidget(
      chatStub({
        liveItems: [
          { id: 'u1', role: 'user', text: 'add groceries' },
          {
            id: 'a1',
            role: 'assistant',
            text: 'Sure! When is it due?\n[[status: ? Need a due date for that one]]',
          },
        ],
      }),
    )
    expect(screen.getByText(/waiting on your reply/i)).toBeInTheDocument()
    // The strip shows the question itself (the body sentence that asked).
    expect(screen.getByText(/When is it due/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yes, go ahead' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'open the full chat' }))
    expect(onOpenChat).toHaveBeenCalledOnce()
  })

  it('a cold resume (question only in hydrated history, not liveItems) does NOT read as waiting', () => {
    // The persistence fix: opening the app on a resumed session must not replay last night's question
    // as an active "waiting on you" state. Only liveItems (this visit) drive the widget status.
    renderWidget(
      chatStub({
        items: [{ id: 'a1', role: 'assistant', text: 'Sure! When is it due?' }], // hydrated base
        liveItems: [], // nothing streamed this visit
      }),
    )
    expect(screen.queryByText(/waiting on your reply/i)).not.toBeInTheDocument()
  })

  it('switching to Manual while BabyClaw waits dots his tab so the state stays visible', () => {
    renderWidget(chatStub({ pending: { toolUseId: 't1', summary: 'Delete "x"' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    expect(screen.getByRole('button', { name: 'BabyClaw' }).getAttribute('title')).toMatch(
      /waiting for your reply/i,
    )
    // The strip itself belongs to BabyClaw mode — Manual shows the plain add form.
    expect(screen.queryByText(/waiting on your reply/i)).not.toBeInTheDocument()
  })
})
