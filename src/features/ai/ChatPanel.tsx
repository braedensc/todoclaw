import { createPortal } from 'react-dom'
import type { ChatController } from './use-chat-controller'
import { ChatConversation } from './ChatConversation'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { useBodyScrollLock } from '../../hooks/use-body-scroll-lock'

// MOBILE chat shell (< 720px): a bottom sheet overlay. On desktop the chat is a push-drawer
// (ChatRail) that shrinks the grid instead of covering it — there's no room to push on a phone,
// so mobile keeps the covering sheet. `wide:hidden` guarantees only one shell is visible at a
// time even though AppShell mounts both. Rendered only while the chat is open.
//
// The sheet grows to near-full height (92dvh) over the still-mounted home screen — a sliver of
// home stays visible above it under the scrim, so the user stays oriented. The message history
// scrolls INSIDE the sheet (ChatConversation's list, `overscroll-contain`); the page behind is
// scroll-locked while the sheet is up. Slide-up/scrim animations reuse the BottomSheet keyframes
// (src/index.css); dismissal is the scrim tap or the conversation's ✕ (plus browser Back when
// opened via a #/chat deep link — App routes that close through `navigate('home')`).
export function ChatPanel({ chat, onClose }: { chat: ChatController; onClose: () => void }) {
  // Lock only on mobile: this component also mounts (display:none) on desktop, where ChatRail is
  // a non-modal push drawer and the page must keep scrolling.
  const isMobile = useIsMobile()
  useBodyScrollLock(isMobile)

  // Portaled to <body> like BottomSheet, so a later-mounted portal sheet at the same z-index
  // can't paint over it and no transformed/padded ancestor interferes with `fixed`.
  return createPortal(
    <div className="fixed inset-0 z-50 wide:hidden">
      {/* Scrim: dims the home screen behind and dismisses on tap (matches BottomSheet). */}
      <div
        aria-hidden
        className="bottom-sheet-scrim absolute inset-0 bg-ink/40"
        onClick={onClose}
      />
      <aside
        aria-label="Chat"
        className="bottom-sheet-panel absolute inset-x-0 bottom-0 flex h-[92dvh] flex-col rounded-t-2xl border border-border-strong bg-panel shadow-xl"
      >
        <ChatConversation chat={chat} onClose={onClose} />
      </aside>
    </div>,
    document.body,
  )
}
