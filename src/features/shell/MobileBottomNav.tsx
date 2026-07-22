import type { AppRoute } from '../../lib/route'

// MobileBottomNav — the thumb-zone bottom bar for the phone shell (Concept D). Home and Done are
// full routes (ADR-0027/0028): tapping one navigates the app route and the active tab gets a
// distinct selected treatment (a short accent bar across its top edge + accent icon/label +
// aria-current), so there's always a Home tab back to the task list — no ✕ needed. Plus the
// primary "Add" action (a subtle accent ring on just its ✚ glyph, not a full tint, so it reads as
// a normal tab until selected — which it never is, being an action not a route), BabyClaw's Chat,
// and the "More" overflow (which now holds Daily reminders alongside Settings/Backups). Rendered
// only on mobile (App gates on useIsMobile) as the LAST in-flow child of the shell's flex column
// (App.tsx + index.css) — so it always hugs the true bottom edge on every device, rather than
// floating via `position: fixed` (which could sit a hair above the screen bottom on smaller
// iPhones). Lifted clear of the iPhone home indicator by a safe-area inset plus a little breathing
// room (needs viewport-fit=cover in index.html or the inset resolves to 0).
//
// The on-screen keyboard never moves it either: interactive-widget=resizes-visual (index.html)
// keeps the keyboard an OVERLAY on every platform, so the 100dvh column — and this bar with it —
// stays put while typing (the bar simply sits behind the keys). Keyboard-aware surfaces re-fit to
// the visible area via useKeyboardViewport instead; App's useLockedViewportGuard clears any iOS
// focus-scroll residue that would otherwise leave the bar floating above the screen bottom.
//
// Labelled <nav aria-label="Account"> with a real "Done" button so the golden `openDone` helper —
// getByRole('navigation', {name:'Account'}).getByRole('button', {name:'Done'}) — keeps working; on
// mobile this is the ONLY Account nav (the desktop header one is not rendered).
//
// data-tour="options": the feature tour's closing panel spotlights this REAL bar directly (no
// look-alike copy mounted inside DemoScene).

function NavItem({
  glyph,
  label,
  onClick,
  primary = false,
  active = false,
  badge = false,
  tour,
}: {
  glyph: string
  label: string
  onClick: () => void
  /** Subtle "primary action" hint — a faint accent ring on just the ✚ glyph (the "Add" tab). */
  primary?: boolean
  /** This destination is the current route — selected treatment + marks it the current page. */
  active?: boolean
  /** Unread indicator — a small slate dot on the glyph (the Chat tab, for unread plan/recap). */
  badge?: boolean
  /** Optional FeatureTour anchor name (`data-tour`); no live tour step targets the nav tabs today. */
  tour?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour={tour}
      aria-current={active ? 'page' : undefined}
      className={
        'relative flex min-h-[64px] flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-medium leading-tight transition-colors ' +
        (active ? 'text-primary' : 'text-muted hover:text-ink')
      }
    >
      {/* Selected-tab indicator: a short rounded accent bar flush to the tab's top edge. */}
      {active && (
        <span aria-hidden className="absolute inset-x-5 top-0 h-1 rounded-b-full bg-primary" />
      )}
      {/* Every glyph sits in the same 28px box so the ✚ ring can't nudge label baselines out of row. */}
      <span
        aria-hidden
        className={
          'relative flex h-7 w-7 items-center justify-center rounded-full text-xl leading-none ' +
          (primary && !active ? 'text-primary ring-1 ring-primary/40' : '')
        }
      >
        {glyph}
        {/* Unread dot — BabyClaw's slate (matches the inbox badge), not alert-red. */}
        {badge && (
          <span className="absolute right-0 top-0.5 h-2 w-2 rounded-full bg-puppy ring-2 ring-panel" />
        )}
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
  unread = 0,
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
  /** Unread plan/recap count — surfaces a dot on the Chat tab (the chat drawer is the inbox now). */
  unread?: number
}) {
  return (
    <nav
      aria-label="Account"
      data-tour="options"
      // In normal flow (flex child), full-width, never shrinking. px-3 keeps the outer tabs off the
      // screen's rounded corners; divide-x draws a hairline between tabs; the bottom padding stacks
      // a little breathing room on top of the home-indicator inset (which is 0 on non-notch devices).
      className="z-40 flex shrink-0 items-stretch divide-x divide-border border-t border-border bg-panel/95 px-3 backdrop-blur"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 5px)' }}
    >
      <NavItem glyph="⌂" label="Home" onClick={onHome} active={route === 'home'} />
      <NavItem glyph="✚" label="Add" onClick={onAdd} primary tour="nav-add" />
      {/* 🐾 is BabyClaw's identity mark app-wide (add-sheet toggle, Settings) — the chat IS him, and
          IS the inbox now, so the unread plan/recap dot rides on this tab. */}
      {onChat && (
        <NavItem
          glyph="🐾"
          label="Chat"
          onClick={onChat}
          active={route === 'chat'}
          badge={unread > 0}
        />
      )}
      <NavItem glyph="✓" label="Done" onClick={onDone} active={route === 'done'} />
      <NavItem glyph="⋯" label="More" onClick={onMore} tour="nav-more" />
    </nav>
  )
}
