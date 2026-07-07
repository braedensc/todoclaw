import type { AppRoute } from '../../lib/route'

// MobileBottomNav — the thumb-zone bottom bar for the phone shell (Concept D). Hosts the primary
// "Add" action plus the account/utility destinations (Reminders, Done, More), moving them out of
// the tall header so the matrix owns the fold. Rendered only on mobile (App gates on useIsMobile),
// fixed to the bottom edge with a safe-area inset.
//
// Reminders / Done are now full pages (ADR-0027): tapping them navigates the app route, and the
// active destination is highlighted (accent + aria-current) so the bar reads like tabs. Labelled
// <nav aria-label="Account"> with a real "Done" button so the golden `openDone` helper —
// getByRole('navigation', {name:'Account'}).getByRole('button', {name:'Done'}) — keeps working; on
// mobile this is the ONLY Account nav (the desktop header one is not rendered). The Grid/List
// switch stays the embedded ViewToggle in the work area, untouched.

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
        'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ' +
        (accent || active ? 'text-primary' : 'text-muted hover:text-ink')
      }
    >
      <span aria-hidden className="text-xl leading-none">
        {glyph}
      </span>
      {label}
    </button>
  )
}

export function MobileBottomNav({
  route,
  onAdd,
  onReminders,
  onDone,
  onMore,
}: {
  /** The active route, so the matching destination reads as the current tab. */
  route: AppRoute
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
      <NavItem glyph="✚" label="Add" onClick={onAdd} accent />
      <NavItem glyph="⚐" label="Reminders" onClick={onReminders} active={route === 'reminders'} />
      <NavItem glyph="✓" label="Done" onClick={onDone} active={route === 'done'} />
      <NavItem glyph="⋯" label="More" onClick={onMore} />
    </nav>
  )
}
