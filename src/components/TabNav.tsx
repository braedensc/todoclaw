// Lightweight tab navigation — no router (project convention: useState over a routing dep
// for a four-tab single-screen app). The active tab is owned by App; this is a controlled,
// presentational component. aria-current marks the active tab for assistive tech.
import { TABS, type Tab } from './tabs'

type TabNavProps = {
  active: Tab
  onChange: (tab: Tab) => void
}

export function TabNav({ active, onChange }: TabNavProps) {
  return (
    <nav aria-label="Views" className="flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            className={
              'rounded-t-md px-4 py-2 text-sm font-medium transition-colors ' +
              (isActive
                ? 'border-b-2 border-primary text-ink'
                : 'border-b-2 border-transparent text-muted hover:text-ink')
            }
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
