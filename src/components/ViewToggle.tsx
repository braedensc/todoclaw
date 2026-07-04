import { WORK_VIEWS, type WorkView } from './tabs'

// The embedded Grid ⇄ List toggle (B8, item 24). A small notched segmented control that
// straddles the top border line of the work region (the caller positions it absolutely,
// centered on that edge); the selected side is a filled ink chip, the other a quiet label.
// It replaces the old separate TabNav strip / fixed bottom tab bar on BOTH desktop and mobile
// (on mobile it's just the same control, compact). Rendered on the grid's top border AND the
// list's for symmetry, but only one is mounted at a time (the views swap).
//
// It stays a <nav aria-label="Views"> of <button>s with aria-current so assistive tech and the
// E2E `switchTab` helper (which finds this nav + a Grid/List button) are layout-independent.

type ViewToggleProps = {
  view: WorkView
  onSelect: (view: WorkView) => void
}

export function ViewToggle({ view, onSelect }: ViewToggleProps) {
  return (
    <nav
      aria-label="Views"
      className="inline-flex items-center gap-0.5 rounded-full border border-border-strong bg-bg p-0.5 shadow-sm"
    >
      {WORK_VIEWS.map((v) => {
        const isActive = v.id === view
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v.id)}
            aria-current={isActive ? 'page' : undefined}
            className={
              'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ' +
              (isActive ? 'bg-ink text-white shadow-sm' : 'text-muted hover:text-ink')
            }
          >
            <span aria-hidden>{v.icon}</span>
            {v.label}
          </button>
        )
      })}
    </nav>
  )
}
