import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ChatController } from './use-chat-controller'

// Mock the session list to a marker with buttons that fire its callbacks — the list's own data layer
// is covered in ChatSessionList.test.tsx; here we test the top-right menu's open/close + wiring.
vi.mock('./ChatSessionList', () => ({
  ChatSessionList: ({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) => (
    <div>
      <span>session list</span>
      <button onClick={onNew}>list-new</button>
      <button onClick={() => onOpen('s1')}>list-open-s1</button>
    </div>
  ),
}))

import { ChatMenu } from './ChatMenu'

const controller = (over: Partial<ChatController> = {}): ChatController =>
  ({
    items: [],
    liveItems: [],
    busy: false,
    pending: null,
    error: null,
    paused: false,
    sessionId: null,
    send: vi.fn(),
    confirm: vi.fn(),
    deny: vi.fn(),
    seed: vi.fn(),
    openSession: vi.fn(),
    newChat: vi.fn(),
    ...over,
  }) as ChatController

describe('ChatMenu', () => {
  it('is closed until the trigger is clicked', () => {
    render(<ChatMenu chat={controller()} onOpenChat={vi.fn()} />)
    expect(screen.queryByText('session list')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Chat/ }))
    expect(screen.getByText('session list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open full chat/ })).toBeInTheDocument()
  })

  it('New chat starts a fresh chat, opens the drawer, and closes the menu', () => {
    const chat = controller()
    const onOpenChat = vi.fn()
    render(<ChatMenu chat={chat} onOpenChat={onOpenChat} />)
    fireEvent.click(screen.getByRole('button', { name: /Chat/ }))
    fireEvent.click(screen.getByRole('button', { name: 'list-new' }))
    expect(chat.newChat).toHaveBeenCalled()
    expect(onOpenChat).toHaveBeenCalled()
    expect(screen.queryByText('session list')).not.toBeInTheDocument() // menu closed
  })

  it('opening a saved session resumes it, opens the drawer, and closes the menu', () => {
    const chat = controller()
    const onOpenChat = vi.fn()
    render(<ChatMenu chat={chat} onOpenChat={onOpenChat} />)
    fireEvent.click(screen.getByRole('button', { name: /Chat/ }))
    fireEvent.click(screen.getByRole('button', { name: 'list-open-s1' }))
    expect(chat.openSession).toHaveBeenCalledWith('s1')
    expect(onOpenChat).toHaveBeenCalled()
    expect(screen.queryByText('session list')).not.toBeInTheDocument()
  })

  it('"Open full chat" opens the drawer on the current conversation', () => {
    const onOpenChat = vi.fn()
    render(<ChatMenu chat={controller()} onOpenChat={onOpenChat} />)
    fireEvent.click(screen.getByRole('button', { name: /Chat/ }))
    fireEvent.click(screen.getByRole('button', { name: /Open full chat/ }))
    expect(onOpenChat).toHaveBeenCalled()
    expect(screen.queryByText('session list')).not.toBeInTheDocument()
  })

  it('closes when clicking outside', () => {
    render(
      <div>
        <ChatMenu chat={controller()} onOpenChat={vi.fn()} />
        <button>outside</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Chat/ }))
    expect(screen.getByText('session list')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByText('session list')).not.toBeInTheDocument()
  })
})
