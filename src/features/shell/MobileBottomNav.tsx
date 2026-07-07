import type { AppRoute } from '../../lib/route'

// MobileBottomNav — the thumb-zone bottom bar for the phone shell (Concept D). Now that Home, Done,
// and Daily reminders are all full routes (ADR-0027/0028), the bar reads like real tabs: tapping a
// destination navigates the app route and the active one is highlighted (accent + aria-current), so
// there's always a Home tab back to the task list — no ✕ needed. Plus the primary "Add" action and
// the "More" overflow. Rendered only on mobile (App gates on useIsMobile), fixed to the bottom edge
// with a safe-area inset.
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
        'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-medium leading-tight transition-colors ' +
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
  onReminders,
  onDone,
  onMore,
}: {
  /** The active route, so the matching destination reads as the current tab. */
  route: AppRoute
  onHome: () => void
  onAdd: () => void
  onReminders: () => void
  onDone: () => void
  onMore: () => void
}) {
  return (
    <nav
      aria-label="Account"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-panel/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <NavItem glyph="⌂" label="Home" onClick={onHome} active={route === 'home'} />
      <NavItem glyph="✚" label="Add" onClick={onAdd} accent />
      <NavItem
        glyph="⚐"
        label="Daily reminders"
        onClick={onReminders}
        active={route === 'reminders'}
      />
      <NavItem glyph="✓" label="Done" onClick={onDone} active={route === 'done'} />
      <NavItem glyph="⋯" label="More" onClick={onMore} />
    </nav>
  )
}
