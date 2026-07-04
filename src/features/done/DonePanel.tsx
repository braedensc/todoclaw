import { DoneView } from './DoneView'

// Done history as a header-opened overlay (B8, item 19). Done left the main view set (the grid ⇄
// list toggle) and now opens like Backups: a modal dialog over the current view. It wraps the
// unchanged DoneView (which keeps its own `aria-label="Done"` region, so the golden specs still
// locate the history list by region). z-50 so it covers the mobile chat sheet / any panel.
export function DonePanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Done history"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-16"
      onClick={onClose}
    >
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <header className="mb-2 flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-ink">Done</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close done"
            className="text-lg text-muted hover:text-ink"
          >
            ✕
          </button>
        </header>
        <DoneView />
      </div>
    </div>
  )
}
