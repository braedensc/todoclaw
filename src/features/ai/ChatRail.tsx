import type { ChatController } from './use-chat-controller'
import { ChatConversation } from './ChatConversation'
import type { ChatView } from './ChatConversation'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { useBackgroundDismiss } from '../../hooks/use-background-dismiss'
import { useKeyboardViewport } from '../../hooks/use-keyboard-viewport'

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
  raised = false,
}: {
  chat: ChatController
  open: boolean
  onClose: () => void
  /** Which face to show. Owned by App — this rail stays mounted, so it can't hold the state itself. */
  view?: ChatView
  onViewChange?: (view: ChatView) => void
  /** Step into the z-50 band over the grid-only overlay so chat stays reachable there (see className). */
  raised?: boolean
}) {
  // Press the page's inert background (empty grid canvas, the gutters around the content column) to
  // close. This rail has no scrim to tap — it pushes the grid rather than covering it — so without
  // this the only way out is the header ✕. Deliberately NOT a plain click-outside: the app stays
  // live behind a push drawer, so adding a task, opening settings, or dragging a card must all
  // leave it open. See useBackgroundDismiss for why that's an allowlist.
  //
  // Mobile is excluded: this rail is display:none there (`wide:flex`) while the covering ChatPanel
  // sheet takes over, and that sheet already dismisses on a scrim tap / swipe / Back. Without the
  // guard this still-mounted rail would close that sheet on a background press behind the scrim.
  const isMobile = useIsMobile()
  useBackgroundDismiss(onClose, open && !isMobile)

  // This full-height rail also serves small iPads (desktop side of the layout gate; landscape
  // iPhones are MOBILE since ADR 2026-07-23 and get the ChatPanel sheet, never this rail),
  // where a real software keyboard eats the bottom of the screen and would bury the rail's
  // bottom-anchored composer behind the keys. Mirror ChatPanel: while the keyboard is up, clamp the rail into the
  // visible band (pin its bottom above the keyboard, take the visible height) so the composer lands
  // above it. Scoped to `open` so the listeners only run while the rail is up; the hook returns
  // CLOSED where visualViewport is unsupported, so a mouse-driven desktop keeps its static layout.
  const kb = useKeyboardViewport(open)

  return (
    <aside
      aria-label="Chat"
      aria-hidden={!open}
      className={
        // Normally z-40 (under the z-50 modal band). While grid-only mode is up (`raised`), the
        // z-50 fullscreen grid overlay would bury the rail, and chat must stay reachable in every
        // mode — so the rail steps to z-50, NOT higher: within the z-50 band, paint order is DOM
        // order, and this rail sits after the overlay (inside #root) but before the body-portaled
        // sheets (BottomSheet & co. append to <body> on open). So the raised rail clears the grid
        // takeover while the touch grid's own task/cluster/add sheets still cover the rail — the
        // same sheet-over-rail relationship as normal mode (z-[55] buried them; touch-grid review).
        `fixed right-0 top-0 ${raised ? 'z-50' : 'z-40'} hidden h-screen w-[420px] flex-col border-l border-border-strong bg-panel shadow-xl transition-transform duration-300 ease-out wide:flex ` +
        (open ? 'translate-x-0' : 'pointer-events-none translate-x-full')
      }
      // Keyboard up: override top-0/h-screen so the rail spans only the visible band above the keys
      // (see kb note above). Anchored by `top` + `height` straight from visualViewport — never by
      // bottom-inset, which is derived from window.innerHeight and lands wrong wherever the
      // keyboard shrinks or pans the layout viewport (installed PWA; see use-keyboard-viewport).
      // Horizontal (`right-0 w-[420px]`) and the AppShell `wide:pr-[420px]` push are untouched.
      style={kb.keyboardOpen ? { top: kb.top, height: kb.height } : undefined}
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
