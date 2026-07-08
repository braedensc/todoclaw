import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '../hooks/use-body-scroll-lock'

// BottomSheet — the shared modal sheet the mobile redesign opens for its contextual flows
// (Move-to-quadrant picker, Add task, task detail/edit). Themed like the app's other overlays
// (ConfirmDialog / SettingsPanel): a warm-paper card over a dimmed scrim, click-outside + Escape
// to dismiss, portaled to <body> so it escapes any transformed / z-indexed ancestor. Unlike those
// centered modals it anchors to the BOTTOM edge and slides up (thumb-zone reach) with a grab
// handle — the current mobile-UX standard for contextual edit/action flows, keeping the surface
// behind it visible so the user stays oriented.
//
// Controlled + presentational: it renders only while `open`, owns no business state, and reports
// dismissal via `onClose` (scrim click OR Escape). Focus moves into the sheet on open (to
// `initialFocusRef` if given, else the sheet itself), Tab is trapped within it, and focus is
// restored to the previously-focused element on close — matching ConfirmDialog's a11y contract.
//
// Give it an accessible name via `title` (rendered as a visible heading + wired to
// aria-labelledby) OR `ariaLabel` (when the heading is supplied by the children).
//
// `fullScreen` swaps the bottom-anchored card for a 100dvh takeover (mobile add-task): dvh so the
// iOS URL bar collapsing doesn't leave a gap, env(safe-area-inset-*) padding so content clears the
// notch/home indicator (needs viewport-fit=cover in index.html), and — since the grab-handle+scrim
// affordance is invisible at full height — a header row with an explicit ✕ close button. The body
// becomes the scroll container (overscroll-contained) so when the on-screen keyboard compresses
// the viewport the sheet's inside scrolls, never the page. Same scrim/trap/animation contract.

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface BottomSheetProps {
  /** Whether the sheet is shown. When false, nothing renders (no scrim, no trap). */
  open: boolean
  /** Called when the user dismisses via the scrim or Escape. */
  onClose: () => void
  /** Visible heading; also names the dialog (aria-labelledby). Omit when children supply a heading
   *  — then pass `ariaLabel` instead. */
  title?: string
  /** Accessible name used when there is no visible `title`. */
  ariaLabel?: string
  /** Element to focus when the sheet opens. Defaults to the sheet container. */
  initialFocusRef?: RefObject<HTMLElement>
  /** Full-screen takeover (100dvh + safe-area insets + ✕ header) instead of the bottom card. */
  fullScreen?: boolean
  /** Extra classes for the sheet panel (e.g. a max-height for a scrollable body). */
  className?: string
  children: ReactNode
}

export function BottomSheet({
  open,
  onClose,
  title,
  ariaLabel,
  initialFocusRef,
  fullScreen = false,
  className = '',
  children,
}: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // The page behind a modal sheet must not scroll — scrolling belongs INSIDE the sheet.
  useBodyScrollLock(open)

  useEffect(() => {
    if (!open) return

    // Remember what was focused so we can restore it when the sheet closes (AT + keyboard users
    // land back where they were, not at the top of the document).
    const restoreTo = document.activeElement as HTMLElement | null
    // The portaled node is already committed by the time this effect runs, so we can focus
    // synchronously (as ConfirmDialog does): the requested element, else the panel itself
    // (tabIndex=-1 makes it programmatically focusable).
    ;(initialFocusRef?.current ?? panelRef.current)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      // Trap Tab within the panel so focus can't escape behind the scrim.
      const panel = panelRef.current
      if (!panel) return
      const items = panel.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (items.length === 0) {
        // Nothing focusable inside — keep focus on the panel.
        e.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      restoreTo?.focus?.()
    }
  }, [open, onClose, initialFocusRef])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Scrim: dims the surface behind and dismisses on click. aria-hidden so AT sees only the
          dialog; the panel's stopPropagation keeps clicks inside from bubbling out to here. */}
      <div
        aria-hidden
        className="bottom-sheet-scrim absolute inset-0 bg-ink/40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : ariaLabel}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`bottom-sheet-panel relative outline-none ${
          fullScreen
            ? 'flex h-dvh w-full flex-col bg-panel px-4'
            : 'w-full max-w-md rounded-t-2xl border border-border-strong bg-panel px-4 pb-6 pt-2 shadow-xl'
        } ${className}`.trim()}
        style={
          fullScreen
            ? {
                paddingTop: 'env(safe-area-inset-top)',
                paddingBottom: 'env(safe-area-inset-bottom)',
              }
            : undefined
        }
      >
        {fullScreen ? (
          // Full height hides the grab-handle/scrim affordance, so name the surface and give an
          // explicit way out: heading left, ✕ right (44px-ish tap target, optically flush).
          <header className="flex shrink-0 items-center justify-between pb-1 pt-2">
            {title && (
              <h2 id={titleId} className="font-serif text-lg font-semibold text-ink">
                {title}
              </h2>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:text-ink"
            >
              ✕
            </button>
          </header>
        ) : (
          <>
            {/* Grab handle — a visual affordance that this is a draggable/dismissable sheet. */}
            <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-border-strong" />
            {title && (
              <h2 id={titleId} className="mb-1 font-serif text-base font-semibold text-ink">
                {title}
              </h2>
            )}
          </>
        )}
        {fullScreen ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>,
    document.body,
  )
}
