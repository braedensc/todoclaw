import { useRef, useState } from 'react'
import type { ChatController } from './use-chat-controller'
import { ChatSessionList } from './ChatSessionList'
import { useClickOutside } from '../../hooks/use-click-outside'

// The DESKTOP top-right entry point for BabyClaw chats (persistent-chats UX, 2026-07-14). Chat is an
// assistant in a planner-first app, so session management lives in the top-right nav — NOT inside the
// conversation drawer. Clicking "🐾 Chat" drops a menu: ＋ New chat + your recent conversations
// (open to resume, ✕ to delete) + "Open full chat". Picking anything opens the chat rail on it. The
// drawer itself is then only ever the conversation (no history list, no new-chat button in it).
export function ChatMenu({ chat, onOpenChat }: { chat: ChatController; onOpenChat: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)

  // Every action opens the conversation drawer and closes the menu.
  const enter = () => {
    onOpenChat()
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="BabyClaw chats"
        className="hover:text-ink"
      >
        <span aria-hidden>🐾</span> Chat
      </button>
      {open && (
        <div
          role="menu"
          aria-label="BabyClaw chats"
          className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border border-border-strong bg-panel text-ink shadow-xl"
        >
          <ChatSessionList
            currentId={chat.sessionId}
            onOpen={(id) => {
              chat.openSession(id)
              enter()
            }}
            onNew={() => {
              chat.newChat()
              enter()
            }}
          />
          <button
            type="button"
            onClick={enter}
            className="block w-full border-t border-border px-4 py-2.5 text-left text-sm font-medium text-primary hover:bg-card"
          >
            Open full chat <span aria-hidden>→</span>
          </button>
        </div>
      )}
    </div>
  )
}
