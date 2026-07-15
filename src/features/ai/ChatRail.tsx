import type { ChatController } from './use-chat-controller'
import { ChatConversation } from './ChatConversation'
import type { ChatView } from './ChatConversation'

// DESKTOP chat shell (≥ 720px): a slide-out RIGHT column that PUSHES the grid left instead of
// covering it (B2 decision). It's a fixed, full-height panel pinned to the viewport's right edge;
// AppShell pairs it with an animated `pr-[420px]` on the main content so the grid column shrinks
// in step and the %-positioned cards reflow correctly (the grid keeps its aspect-lock, so it just
// scales down uniformly — clustering thresholds are unaffected). Hidden below the breakpoint
// (`wide:flex`), where the covering ChatPanel bottom-sheet takes over. Kept mounted and slid off
// via translate so the open/close transition is smooth.
//
// The session switcher lives IN the drawer now (the "See all chats" button swaps to the unified
// history, with a back button) — the old top-right ChatMenu dropdown is retired, so desktop and
// mobile drive sessions the same way (`enableSessions`).
export function ChatRail({
  chat,
  open,
  onClose,
  view,
  onViewChange,
}: {
  chat: ChatController
  open: boolean
  onClose: () => void
  /** Which face to show. Owned by App — this rail stays mounted, so it can't hold the state itself. */
  view?: ChatView
  onViewChange?: (view: ChatView) => void
}) {
  return (
    <aside
      aria-label="Chat"
      aria-hidden={!open}
      className={
        'fixed right-0 top-0 z-40 hidden h-screen w-[420px] flex-col border-l border-border-strong bg-panel shadow-xl transition-transform duration-300 ease-out wide:flex ' +
        (open ? 'translate-x-0' : 'pointer-events-none translate-x-full')
      }
    >
      <ChatConversation
        chat={chat}
        onClose={onClose}
        enableSessions
        view={view}
        onViewChange={onViewChange}
      />
    </aside>
  )
}
