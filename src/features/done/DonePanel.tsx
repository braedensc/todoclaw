import { useEffect, useRef } from 'react'
import { DoneView } from './DoneView'

// Done history as a header-opened overlay (B8, item 19). Done left the main view set (the grid ⇄
// list toggle) and now opens like Backups: a modal dialog over the current view. The panel body
// is DoneView, which owns the parchment card AND the header (title + ✕ close) so they sit INSIDE
// the modal; DonePanel is just the backdrop + centering + focus management. z-50 so it covers the
// mobile chat sheet / any panel.
export function DonePanel({ onClose }: { onClose: () => void }) {
  // Move focus into the dialog on open — onto this (unstyled) container, NOT the ✕ close button.
  // If the ✕ were the first focusable element it would get auto-focused and show the browser's
  // default focus outline the instant the modal opened; landing focus here keeps the modal
  // keyboard-accessible while the ✕ only shows its themed ring when a user actually tabs to it.
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  return (
    <div
      role="dialog"
      aria-label="Done history"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-16"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-lg focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <DoneView onClose={onClose} />
      </div>
    </div>
  )
}
