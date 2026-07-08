import type { AppRoute } from '../../lib/route'

// MobileBottomNav — the thumb-zone bottom bar for the phone shell (Concept D). Home and Done are
// full routes (ADR-0027/0028): tapping one navigates the app route and the active tab is
// highlighted (accent + aria-current), so there's always a Home tab back to the task list — no ✕
// needed. Plus the primary "Add" action, BabyClaw's Chat, and the "More" overflow (which now holds
// Daily reminders alongside Settings/Backups). Rendered only on mobile (App gates on useIsMobile),
// fixed to the bottom edge, lifted clear of the iPhone home indicator by a safe-area inset plus
// real breathing room (needs viewport-fit=cover in index.html or the inset resolves to 0).
//
// Labelled <nav aria-label="Account"> with a real "Done" button so the golden `openDone` helper —
// getByRole('navigation', {name:'Account'}).getByRole('button', {name:'Done'}) — keeps working; on
// mobile this is the ONLY Account nav (the desktop header one is not rendered).

function NavItem({
  glyph,
  label,
  onClick,
  accent = false,
  active = false,
}: {
  glyph: string
  label: string
  onClick: () => void
  /** Always-on primary tint (the "Add" action). */
  accent?: boolean
  /** This destination is the current route — tints it and marks it the current page for a11y. */
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={
        'flex min-h-[64px] flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-medium leading-tight transition-colors ' +
        (accent || active ? 'text-primary' : 'text-muted hover:text-ink')
      }
    >
      <span aria-hidden className="text-lg leading-none">
        {glyph}
      </span>
      {/* Fixed two-line-tall box so single- and multi-word labels stay vertically aligned. */}
      <span className="flex h-[22px] items-center text-center">{label}</span>
    </button>
  )
}

export function MobileBottomNav({
  route,
  onHome,
  onAdd,
  onChat,
  onDone,
  onMore,
}: {
  /** The active route, so the matching destination reads as the current tab. */
  route: AppRoute
  onHome: () => void
  onAdd: () => void
  /**
   * Opens the BabyClaw chat sheet. Optional so a future per-user AI-enabled flag can simply omit
   * it to hide the tab — the remaining four flex items reflow to fill the bar. Today the
   * invite-only app gives every signed-in user AI (ADR-0014/0015), so App always passes it.
   */
  onChat?: () => void
  onDone: () => void
  onMore: () => void
}) {
  return (
    <nav
      aria-label="Account"
      // px-3 keeps the outer tabs off the screen's rounded corners; the bottom padding stacks
      // real breathing room on top of the home-indicator inset (which is 0 on non-notch devices).
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-panel/95 px-3 backdrop-blur"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)' }}
    >
      <NavItem glyph="⌂" label="Home" onClick={onHome} active={route === 'home'} />
      <NavItem glyph="✚" label="Add" onClick={onAdd} accent />
      {/* 🐾 is BabyClaw's identity mark app-wide (add-sheet toggle, Settings) — the chat IS him. */}
      {onChat && <NavItem glyph="🐾" label="Chat" onClick={onChat} active={route === 'chat'} />}
      <NavItem glyph="✓" label="Done" onClick={onDone} active={route === 'done'} />
      <NavItem glyph="⋯" label="More" onClick={onMore} />
    </nav>
  )
}
