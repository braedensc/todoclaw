import { useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ChatController } from './use-chat-controller'
import { ChatConversation } from './ChatConversation'
import type { ChatView } from './ChatConversation'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { useBodyScrollLock } from '../../hooks/use-body-scroll-lock'
import { useSwipeDismiss } from '../../hooks/use-swipe-dismiss'
import { useKeyboardViewport } from '../../hooks/use-keyboard-viewport'

// MOBILE chat shell (< 720px): a bottom sheet overlay. On desktop the chat is a push-drawer
// (ChatRail) that shrinks the grid instead of covering it — there's no room to push on a phone,
// so mobile keeps the covering sheet. `wide:hidden` guarantees only one shell is visible at a
// time even though AppShell mounts both. Rendered only while the chat is open.
//
// The sheet grows to near-full height (92dvh) over the still-mounted home screen — a sliver of
// home stays visible above it under the scrim, so the user stays oriented. The message history
// scrolls INSIDE the sheet (ChatConversation's list, `overscroll-contain`); the page behind is
// scroll-locked while the sheet is up. Slide-up/scrim animations reuse the BottomSheet keyframes
// (src/index.css). Dismissal is a swipe-down on the grab handle, a scrim tap, or Back (when opened
// via a #/chat deep link, App routes the close through `navigate('home')`). No ✕ on mobile —
// ChatConversation gets `showClose={false}`. Unlike the other mobile sheets, a swipe on the sheet
// BODY does not dismiss: it belongs to the message list (see useSwipeDismiss below).
export function ChatPanel({
  chat,
  onClose,
  view,
  onViewChange,
}: {
  chat: ChatController
  onClose: () => void
  /** Which face to show. Owned by App so both shells agree and each entry point can aim the drawer. */
  view?: ChatView
  onViewChange?: (view: ChatView) => void
}) {
  // Lock only on mobile: this component also mounts (display:none) on desktop, where ChatRail is
  // a non-modal push drawer and the page must keep scrolling.
  const isMobile = useIsMobile()
  useBodyScrollLock(isMobile)

  const panelRef = useRef<HTMLElement>(null)
  // iOS overlays the keyboard over the (dvh-sized) sheet instead of resizing it — the sheet keeps
  // its full height, so its top runs off-screen and the composer hides behind the keys. `kb` gives
  // the visible height + keyboard overlap; while the keyboard is up we re-fit the sheet into the
  // visible region below (audit §3.3). CLOSED (all zero) when the keyboard is down or unsupported.
  const kb = useKeyboardViewport(isMobile)
  // Swipe-down-to-dismiss, HANDLE ONLY — the shared hook's whole-panel touch path stays off here
  // (`active: false`); the aside still carries `bottom-sheet-panel`, so the handle drag inherits the
  // transition + spring-back.
  //
  // Every other caller (BottomSheet, ConfirmDialog) keeps the body path, and should: those sheets
  // are short and form-like, so "pull down anywhere" is the whole gesture. The chat sheet is the
  // outlier — it is almost entirely one long scroller. The hook hands a downward pull to the sheet
  // whenever the scroller sits at `scrollTop: 0`, which is fine for a resting form but wrong here:
  // the top of your history is a place you ARRIVE AT by scrolling up, so the reflex to keep pulling
  // is a scroll, not a dismiss — and it was closing the panel mid-read. Scrolling must never be a
  // dismissal. The handle, the scrim, and Back remain, and each of those is deliberate.
  const swipe = useSwipeDismiss(onClose, panelRef, false)

  // Portaled to <body> like BottomSheet, so a later-mounted portal sheet at the same z-index
  // can't paint over it and no transformed/padded ancestor interferes with `fixed`.
  return createPortal(
    <div className="fixed inset-0 z-50 wide:hidden">
      {/* Scrim: dims the home screen behind and dismisses on tap (matches BottomSheet); its opacity
          tracks the drag so home brightens as the sheet is pulled down. */}
      <div
        aria-hidden
        className="bottom-sheet-scrim absolute inset-0 bg-ink/40"
        onClick={onClose}
        style={swipe.dragging ? { opacity: 1 - swipe.progress } : undefined}
      />
      {/* Safe-area bottom padding keeps the chat input clear of the iOS home indicator now that
          viewport-fit=cover extends the layout under it. */}
      <aside
        ref={panelRef}
        aria-label="Chat"
        data-dragging={swipe.dragging ? 'true' : undefined}
        className={`bottom-sheet-panel absolute inset-x-0 bottom-0 flex h-[92dvh] flex-col rounded-t-2xl border border-border-strong bg-panel pb-[env(safe-area-inset-bottom)] shadow-xl ${
          // Safe-area inset for the SAME reason BottomSheet applies one only when `fullScreen`:
          // re-fitting to the visible band (below) makes this sheet full-bleed to that band's top,
          // which viewport-fit=cover puts under the status bar / Dynamic Island. At 92dvh the 8% top
          // gap already clears the notch, so this is needed only while re-fitted. Without it the grab
          // handle and the BabyClaw header render *behind* the status bar — invisible but still
          // touch-live, so a finger reaching for the header instead grabbed the hidden handle and
          // dragged the whole sheet down.
          kb.keyboardOpen ? 'pt-[env(safe-area-inset-top)]' : ''
        }`.trim()}
        style={{
          ...(swipe.offset ? { transform: `translateY(${swipe.offset}px)` } : {}),
          // Keyboard up: the keyboard owns the bottom `inset` px of the layout viewport, so pin the
          // sheet bottom there and give it the visible `height` — this lands the whole sheet
          // (composer included) above the keys with its top on-screen, instead of a full-height
          // sheet whose top is off-screen. Overrides the class's bottom-0/h-[92dvh]; paddingBottom
          // drops to 0 (the home indicator is behind the keyboard now). The matching top inset is a
          // class above, not a value here — it's a constant, and jsdom drops inline `env()`.
          ...(kb.keyboardOpen ? { bottom: kb.inset, height: kb.height, paddingBottom: 0 } : {}),
        }}
      >
        {/* Grab handle — the draggable dismiss affordance (touch-action:none so scroll doesn't
            steal the drag). The BabyClaw header sits just below it inside ChatConversation. */}
        <div
          data-testid="sheet-grabber"
          data-sheet-handle
          onPointerDown={swipe.onPointerDown}
          className="shrink-0 cursor-grab touch-none select-none pt-2"
        >
          <div aria-hidden className="mx-auto h-1 w-9 rounded-full bg-border-strong" />
        </div>
        {/* flex-1 min-h-0 so the conversation (h-full) fills the space LEFT after the handle,
            rather than 92dvh — otherwise the input would be pushed below the safe area. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* The in-drawer session switcher (the "See all chats" button → the unified inbox + saved
              chats) — the same on both shells now that the separate inbox is retired. */}
          <ChatConversation
            chat={chat}
            onClose={onClose}
            showClose={false}
            enableSessions
            view={view}
            onViewChange={onViewChange}
          />
        </div>
      </aside>
    </div>,
    document.body,
  )
}
