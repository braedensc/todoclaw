// Lightweight tab navigation — no router (project convention: useState over a routing dep
// for a four-tab single-screen app). The active tab is owned by App; this is a controlled,
// presentational component. aria-current marks the active tab for assistive tech.
//
// Responsive (Stage 5): on mobile (< 720px) it's a FIXED BOTTOM TAB BAR with full-width,
// thumb-reachable targets (master plan: bottom tab bar on mobile, top toolbar on desktop); at
// the `wide` breakpoint (>= 720px, mirroring MOBILE_MAX_WIDTH) it becomes the original top tab
// row. The <nav aria-label="Views">, the buttons, and aria-current are identical across both
// layouts, so assistive tech and the E2E `switchTab` helper are layout-independent.
import { TABS, type Tab } from './tabs'

type TabNavProps = {
  active: Tab
  onChange: (tab: Tab) => void
}

export function TabNav({ active, onChange }: TabNavProps) {
  return (
    <nav
      aria-label="Views"
      className={
        // Mobile: fixed bottom bar spanning the viewport.
        'fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-border bg-panel ' +
        // Desktop: the original static top tab row.
        'wide:static wide:justify-start wide:gap-1 wide:border-t-0 wide:border-b wide:bg-transparent'
      }
    >
      {TABS.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            className={
              // Mobile: equal-width, tall touch target; active tab marked by a top accent bar.
              'flex flex-1 items-center justify-center border-t-2 py-3 text-sm font-medium transition-colors ' +
              // Desktop: compact top-row tab; the accent moves to the bottom (underline).
              'wide:flex-none wide:rounded-t-md wide:border-t-0 wide:border-b-2 wide:px-4 wide:py-2 ' +
              (isActive
                ? 'border-primary text-ink'
                : 'border-transparent text-muted hover:text-ink')
            }
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
