// Lightweight tab navigation — no router (project convention: useState over a routing dep
// for a three-tab single-screen app). The active tab is owned by App; this is a controlled,
// presentational component. aria-current marks the active tab for assistive tech.
//
// Responsive (Stage 5): on mobile (< 720px) it's a FIXED BOTTOM TAB BAR with full-width,
// thumb-reachable targets (master plan: bottom tab bar on mobile, top toolbar on desktop); at
// the `wide` breakpoint (>= 720px, mirroring MOBILE_MAX_WIDTH) it becomes a segmented-pill
// control (parity: pics/Todopic1.jpeg — a single bordered strip with the active tab raised on
// a white chip) instead of the old underline row. The <nav aria-label="Views">, the buttons,
// and aria-current are identical across both layouts, so assistive tech and the E2E
// `switchTab` helper are layout-independent.
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
        // Desktop: an inline segmented-pill strip (bordered container, not full-width).
        'wide:static wide:inline-flex wide:justify-start wide:gap-1 wide:rounded-lg wide:border wide:border-border-strong wide:bg-panel wide:p-1'
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
              'flex flex-1 items-center justify-center gap-1.5 border-t-2 py-3 text-sm font-medium transition-colors ' +
              // Desktop: a pill segment inside the strip; active tab is a raised white chip.
              'wide:flex-none wide:rounded-md wide:border-t-0 wide:px-3 wide:py-1.5 ' +
              (isActive
                ? 'border-primary text-ink wide:bg-card wide:shadow-sm'
                : 'border-transparent text-muted hover:text-ink')
            }
          >
            <span aria-hidden>{tab.icon}</span>
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
