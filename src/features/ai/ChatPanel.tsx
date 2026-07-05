import type { ChatController } from './use-chat-controller'
import { ChatConversation } from './ChatConversation'

// MOBILE chat shell (< 720px): a bottom sheet overlay. On desktop the chat is a push-drawer
// (ChatRail) that shrinks the grid instead of covering it — there's no room to push on a phone,
// so mobile keeps the covering sheet. `wide:hidden` guarantees only one shell is visible at a
// time even though AppShell mounts both. Rendered only while `showChat` is true.
export function ChatPanel({ chat, onClose }: { chat: ChatController; onClose: () => void }) {
  return (
    <aside
      aria-label="Chat"
      // A bottom sheet (rounded top, capped height) covering the lower screen; z-50 above all.
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border border-border-strong bg-panel shadow-xl wide:hidden"
    >
      <ChatConversation chat={chat} onClose={onClose} />
    </aside>
  )
}
