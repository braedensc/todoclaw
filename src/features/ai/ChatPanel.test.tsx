import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import type { ChatItem, PendingConfirm } from './use-ai-chat'
import type { ChatController } from './use-chat-controller'
import type { ChatView } from './ChatConversation'
// ChatConversation now imports ChatSessionList → use-chat-sessions → lib/supabase (import-throws
// without VITE env in CI). Stub the module, and mock the list to a marker so these shell tests need
// no QueryClientProvider (the list's own data layer is covered in ChatSessionList.test.tsx).
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./ChatSessionList', () => ({
  ChatSessionList: ({ onNew }: { onNew: () => void }) => (
    <div>
      <span>session list</span>
      <button onClick={onNew}>list new chat</button>
    </div>
  ),
}))
// jsdom has no matchMedia, so the real useIsMobile always reports desktop; this mock lets the
// composer Enter-key tests flip the breakpoint. Default: desktop.
const mockIsMobile = vi.fn<() => boolean>(() => false)
vi.mock('../../hooks/use-is-mobile', () => ({
  useIsMobile: () => mockIsMobile(),
}))
import { ChatPanel } from './ChatPanel'

// ChatPanel is now presentational (B8): the shell owns one shared conversation (useChatController)
// and passes it in, so both the inline BabyClaw reply and this popup stay in lockstep. The test
// hands it a fake controller directly — no hook mocking needed.
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

// The drawer's view is CONTROLLED by App now (the entry point picks the face — nav Chat opens the
// list, the widget's "Open chat" opens a conversation), so exercising the in-drawer switcher means
// holding that state the way App does.
function ControlledPanel({
  c,
  initial = 'conversation',
}: {
  c: ChatController
  initial?: ChatView
}) {
  const [view, setView] = useState<ChatView>(initial)
  return <ChatPanel chat={c} onClose={vi.fn()} view={view} onViewChange={setView} />
}

describe('ChatPanel', () => {
  beforeEach(() => mockIsMobile.mockReturnValue(false))

  it('renders user/assistant bubbles and tool notes', () => {
    render(
      <ChatPanel
        chat={chat({
          items: [
            { id: '1', role: 'user', text: 'add dentist' },
            { id: '2', role: 'assistant', text: 'Added it.' },
            { id: '3', role: 'tool', text: 'Created "dentist".', ok: true },
          ],
        })}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('add dentist')).toBeInTheDocument()
    expect(screen.getByText('Added it.')).toBeInTheDocument()
    expect(screen.getByText(/Created "dentist"/)).toBeInTheDocument()

    // BabyClaw's own replies carry his decorative paw avatar (an SVG); the user's messages don't.
    expect(screen.getByText('Added it.').closest('li')?.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('add dentist').closest('li')?.querySelector('svg')).toBeFalsy()
  })

  it('shows the confirmation banner and wires Confirm/Cancel', () => {
    const c = chat({ pending: { toolUseId: 'toolu_9', summary: 'Move "dentist" to the trash' } })
    render(<ChatPanel chat={c} onClose={vi.fn()} />)

    expect(screen.getByText(/Move "dentist" to the trash\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, do it' }))
    expect(c.confirm).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(c.deny).toHaveBeenCalled()
  })

  it('keeps the input usable while a confirmation is pending — a typed yes/no answers it', () => {
    // send() is pending-aware (use-ai-chat routes it to confirm/deny), so the box must stay open.
    const c = chat({ pending: { toolUseId: 'toolu_9', summary: 'Move "dentist" to the trash' } })
    render(<ChatPanel chat={c} onClose={vi.fn()} />)

    const input = screen.getByLabelText('Message')
    expect(input).not.toBeDisabled()
    expect(input.getAttribute('placeholder')).toMatch(/yes or no/i)
    fireEvent.change(input, { target: { value: 'yes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(c.send).toHaveBeenCalledWith('yes')
  })

  it("hides BabyClaw's trailing [[status: …]] line from the bubble", () => {
    render(
      <ChatPanel
        chat={chat({
          items: [
            {
              id: '1',
              role: 'assistant',
              text: 'Added it — due Friday!\n[[status: Added "call mom" 🐾]]',
            },
          ],
        })}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Added it — due Friday!')).toBeInTheDocument()
    expect(screen.queryByText(/\[\[status/)).not.toBeInTheDocument()
  })

  it('sends a message on submit', () => {
    const c = chat()
    render(<ChatPanel chat={c} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(c.send).toHaveBeenCalledWith('hello')
  })

  describe('the composer Enter key', () => {
    it('sends on desktop, and Shift+Enter newlines instead', () => {
      const c = chat()
      render(<ChatPanel chat={c} onClose={vi.fn()} />)
      const input = screen.getByLabelText('Message')

      fireEvent.change(input, { target: { value: 'hello' } })
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
      expect(c.send).not.toHaveBeenCalled()

      fireEvent.keyDown(input, { key: 'Enter' })
      expect(c.send).toHaveBeenCalledWith('hello')
    })

    it('never sends on desktop while an IME candidate is being committed', () => {
      const c = chat()
      render(<ChatPanel chat={c} onClose={vi.fn()} />)
      const input = screen.getByLabelText('Message')
      fireEvent.change(input, { target: { value: 'にほん' } })
      fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
      expect(c.send).not.toHaveBeenCalled()
    })

    it('newlines on mobile — the thumb keyboard Return must never send; the paw button does', () => {
      mockIsMobile.mockReturnValue(true)
      const c = chat()
      render(<ChatPanel chat={c} onClose={vi.fn()} />)
      const input = screen.getByLabelText('Message')

      fireEvent.change(input, { target: { value: 'a line' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(c.send).not.toHaveBeenCalled()
      // The keyboard's own return key is hinted as a newline, not a send.
      expect(input).toHaveAttribute('enterkeyhint', 'enter')

      // The multi-line message still goes out whole when the paw button is tapped.
      fireEvent.change(input, { target: { value: 'a line\nanother line' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      expect(c.send).toHaveBeenCalledWith('a line\nanother line')
    })
  })

  it('shows the paused notice and disables input when AI is paused', () => {
    render(<ChatPanel chat={chat({ paused: true })} onClose={vi.fn()} />)
    expect(screen.getByText(/AI is paused for this month/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toBeDisabled()
  })

  it('toggles the in-drawer history list on mobile; New chat lives in the list, not the header', () => {
    const c = chat()
    render(<ControlledPanel c={c} />)
    // Conversation view first — no history list, and NO ＋ New chat button in the header.
    expect(screen.queryByText('session list')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument()
    // Both shells now offer the in-drawer "See all chats" switcher (the separate inbox is retired).
    fireEvent.click(screen.getByRole('button', { name: /see all chats/i }))
    expect(screen.getByText('Your chats')).toBeInTheDocument()
    expect(screen.getByText('session list')).toBeInTheDocument()
    // "New chat" comes from the list (mocked here), and it returns to the conversation.
    fireEvent.click(screen.getByRole('button', { name: 'list new chat' }))
    expect(c.newChat).toHaveBeenCalled()
    expect(screen.queryByText('session list')).not.toBeInTheDocument()
  })

  it('opens straight onto the chats list when the shell asks for it', () => {
    // What the nav Chat entry does: App sets view='history' as it opens, so the drawer must come up
    // on the list rather than whatever conversation the controller happens to hold.
    render(<ControlledPanel c={chat({ sessionId: 'resumed-session' })} initial="history" />)
    expect(screen.getByText('Your chats')).toBeInTheDocument()
    expect(screen.getByText('session list')).toBeInTheDocument()
    // The composer belongs to the conversation face — it must not be on screen.
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument()
  })

  it('the view is the shell’s to own — the panel never overrides it', () => {
    // Regression guard for the desktop rail, which stays mounted between opens: if the drawer kept
    // its own view state, a later "open on the list" could be swallowed by a stale local value.
    const { rerender } = render(<ChatPanel chat={chat()} onClose={vi.fn()} view="conversation" />)
    expect(screen.queryByText('session list')).not.toBeInTheDocument()
    rerender(<ChatPanel chat={chat()} onClose={vi.fn()} view="history" />)
    expect(screen.getByText('session list')).toBeInTheDocument()
  })

  // Scrolling the history must never dismiss the sheet. The shared hook hands a downward pull to the
  // sheet whenever the scroller sits at scrollTop 0 — right for the short, form-like sheets that use
  // BottomSheet/ConfirmDialog, wrong for a panel that is almost entirely one long scroller, where
  // the top of the history is somewhere you arrive at by scrolling up.
  describe('the swipe gesture', () => {
    beforeEach(() => mockIsMobile.mockReturnValue(true))

    function touch(el: Element, type: string, clientY: number): void {
      const t = { identifier: 1, target: el, clientX: 180, clientY }
      const ev = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(ev, { touches: type === 'touchend' ? [] : [t], changedTouches: [t] })
      el.dispatchEvent(ev)
    }

    it('never dismisses on a body swipe — that pull belongs to the message list', () => {
      const onClose = vi.fn()
      render(<ChatPanel chat={chat()} onClose={onClose} />)
      const sheet = screen.getByLabelText('Chat')
      // A long, deliberate downward pull on the sheet body — far past every dismiss threshold.
      touch(sheet, 'touchstart', 200)
      for (let y = 200; y <= 600; y += 40) touch(sheet, 'touchmove', y)
      touch(sheet, 'touchend', 600)
      expect(onClose).not.toHaveBeenCalled()
      expect(sheet.getAttribute('style') ?? '').not.toMatch(/translateY/)
    })

    it('still dismisses on a deliberate pull of the grab handle', () => {
      const onClose = vi.fn()
      render(<ChatPanel chat={chat()} onClose={onClose} />)
      // The handle is the explicit affordance and keeps working — the point is to move the gesture
      // off the body, not to strand the sheet with no swipe out.
      fireEvent.pointerDown(screen.getByTestId('sheet-grabber'), { clientY: 100, button: 0 })
      fireEvent.pointerMove(window, { clientY: 200 })
      fireEvent.pointerUp(window, { clientY: 300 })
      expect(onClose).toHaveBeenCalled()
    })
  })

  // The keyboard re-fit (#263/#275) pins the sheet into the visible band, which makes it full-bleed
  // to that band's top — and viewport-fit=cover puts that under the status bar / Dynamic Island. At
  // 92dvh the 8% gap clears the notch on its own, so the inset belongs to the re-fitted state only.
  // jsdom has no visualViewport; install a controllable fake, as use-keyboard-viewport.test.ts does.
  describe('the keyboard re-fit and the safe area', () => {
    const INNER = 800
    let listeners: Set<() => void>
    let vv: { height: number; offsetTop: number }

    beforeEach(() => {
      mockIsMobile.mockReturnValue(true)
      listeners = new Set()
      vv = { height: INNER, offsetTop: 0 }
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: {
          get height() {
            return vv.height
          },
          get offsetTop() {
            return vv.offsetTop
          },
          addEventListener: (_t: string, cb: () => void) => listeners.add(cb),
          removeEventListener: (_t: string, cb: () => void) => listeners.delete(cb),
        },
      })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: INNER })
    })
    afterEach(() => {
      Reflect.deleteProperty(window, 'visualViewport')
    })

    function openKeyboard(height: number): void {
      vv.height = INNER - height
      act(() => listeners.forEach((cb) => cb()))
    }

    it('keeps the sheet clear of the status bar while the keyboard is up', () => {
      render(<ChatPanel chat={chat()} onClose={vi.fn()} />)
      const sheet = screen.getByLabelText('Chat')
      // Keyboard down: the sheet sits at 92dvh, whose top gap already clears the notch — an inset
      // here would just eat height for nothing.
      expect(sheet.className).not.toMatch(/pt-\[env\(safe-area-inset-top\)\]/)

      openKeyboard(336)
      // Re-fitted into the visible band… (asserted via the style attribute: jsdom's CSS parser
      // silently DROPS an inline `env()`, which is why the top inset below is a class, not a style.)
      const style = sheet.getAttribute('style') ?? ''
      expect(style).toMatch(/bottom:\s*336px/)
      expect(style).toMatch(/height:\s*464px/)
      // …and held below the status bar. Without this the grab handle and the BabyClaw header render
      // behind it — invisible but still touch-live, so a finger reaching for the header grabbed the
      // hidden handle and dragged the whole sheet down.
      expect(sheet.className).toMatch(/pt-\[env\(safe-area-inset-top\)\]/)
    })
  })
})
