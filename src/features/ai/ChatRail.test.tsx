import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import type { ChatItem, PendingConfirm } from './use-ai-chat'
import type { ChatController } from './use-chat-controller'
import type { ChatView } from './ChatConversation'
import { BACKGROUND_DISMISS_ATTR } from '../../hooks/use-background-dismiss'
// Same stubs as ChatPanel.test: ChatConversation reaches lib/supabase through ChatSessionList,
// which import-throws without VITE env in CI.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./ChatSessionList', () => ({
  ChatSessionList: () => <span>session list</span>,
}))
// jsdom has no matchMedia, so the real useIsMobile reports desktop — which is this rail's own
// breakpoint. The mock lets the mobile-exclusion test flip it.
const mockIsMobile = vi.fn<() => boolean>(() => false)
vi.mock('../../hooks/use-is-mobile', () => ({ useIsMobile: () => mockIsMobile() }))
import { ChatRail } from './ChatRail'

function chat(over: Partial<ChatController> = {}): ChatController {
  return {
    items: [] as ChatItem[],
    liveItems: [] as ChatItem[],
    busy: false,
    pending: null as PendingConfirm | null,
    error: null as string | null,
    paused: false,
    sessionId: null as string | null,
    activeSession: null,
    send: vi.fn(),
    confirm: vi.fn(),
    deny: vi.fn(),
    seed: vi.fn(),
    openSession: vi.fn(),
    newChat: vi.fn(),
    ...over,
  }
}

// The rail's face is controlled by App, so exercising the "Your chats" view means holding that
// state the way App does.
function ControlledRail({
  onClose,
  initial = 'conversation',
  open = true,
}: {
  onClose: () => void
  initial?: ChatView
  open?: boolean
}) {
  const [view, setView] = useState<ChatView>(initial)
  return <ChatRail chat={chat()} open={open} onClose={onClose} view={view} onViewChange={setView} />
}

// Stands in for the app behind the push drawer: a marked background surface (the grid canvas / page
// gutters) with an unmarked card on it, plus an unmarked control (add-task, settings).
function Background() {
  return (
    <div {...{ [BACKGROUND_DISMISS_ATTR]: true }} data-testid="canvas">
      <div data-testid="card">Ship the deck</div>
      <button data-testid="control">Add task</button>
    </div>
  )
}

const press = (el: Element) => fireEvent.pointerDown(el, { button: 0 })

describe('ChatRail', () => {
  const onClose = vi.fn()
  beforeEach(() => {
    onClose.mockReset()
    mockIsMobile.mockReturnValue(false)
  })

  describe('closing from the "Your chats" face', () => {
    it('draws a ✕ that closes the rail', () => {
      render(<ControlledRail onClose={onClose} initial="history" />)
      expect(screen.getByText('Your chats')).toBeInTheDocument()
      fireEvent.click(screen.getByLabelText('Close chat'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    // The bug this fixes: the ✕ lived only on the conversation header, so the nav's Chat entry —
    // which aims at this face — left no way out but "Back to chat" first.
    it('offers Back AND close, not just Back', () => {
      render(<ControlledRail onClose={onClose} initial="history" />)
      expect(screen.getByLabelText('Back to conversation')).toBeInTheDocument()
      expect(screen.getByLabelText('Close chat')).toBeInTheDocument()
    })

    it('still has the ✕ after going back to the conversation', () => {
      render(<ControlledRail onClose={onClose} initial="history" />)
      fireEvent.click(screen.getByLabelText('Back to conversation'))
      fireEvent.click(screen.getByLabelText('Close chat'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('press-the-background to dismiss', () => {
    it('closes when the page background is pressed', () => {
      render(
        <>
          <Background />
          <ControlledRail onClose={onClose} />
        </>,
      )
      press(screen.getByTestId('canvas'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes from the "Your chats" face too', () => {
      render(
        <>
          <Background />
          <ControlledRail onClose={onClose} initial="history" />
        </>,
      )
      press(screen.getByTestId('canvas'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    // The app stays live behind a push drawer, so acting in it must not close the drawer.
    it('does NOT close when a card on the background is pressed', () => {
      render(
        <>
          <Background />
          <ControlledRail onClose={onClose} />
        </>,
      )
      press(screen.getByTestId('card'))
      expect(onClose).not.toHaveBeenCalled()
    })

    it('does NOT close when a control is pressed', () => {
      render(
        <>
          <Background />
          <ControlledRail onClose={onClose} />
        </>,
      )
      press(screen.getByTestId('control'))
      expect(onClose).not.toHaveBeenCalled()
    })

    it('does NOT close when the rail itself is pressed', () => {
      render(
        <>
          <Background />
          <ControlledRail onClose={onClose} />
        </>,
      )
      press(screen.getByText('BabyClaw'))
      expect(onClose).not.toHaveBeenCalled()
    })

    it('is inert while the rail is closed', () => {
      render(
        <>
          <Background />
          <ControlledRail onClose={onClose} open={false} />
        </>,
      )
      press(screen.getByTestId('canvas'))
      expect(onClose).not.toHaveBeenCalled()
    })

    // This rail is display:none on mobile while the covering ChatPanel sheet takes over; if it kept
    // listening it would close that sheet on a press behind the scrim.
    it('is inert on mobile, where the sheet owns dismissal', () => {
      mockIsMobile.mockReturnValue(true)
      render(
        <>
          <Background />
          <ControlledRail onClose={onClose} />
        </>,
      )
      press(screen.getByTestId('canvas'))
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
