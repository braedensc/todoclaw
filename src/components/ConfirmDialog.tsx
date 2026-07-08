import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '../hooks/use-is-mobile'
import { useSwipeDismiss } from '../hooks/use-swipe-dismiss'

// A confirmation modal themed like the app's other overlays (SettingsPanel / BackupsPanel): a
// warm-paper card over a dimmed scrim, click-outside + Escape to dismiss. It is a controlled,
// presentational component — it renders only while mounted and reports the user's choice via
// onConfirm / onCancel. Most callers won't render it directly: they call the promise-returning
// `useConfirm()` hook (use-confirm.tsx), which owns a single instance at the app root.
//
// Rendered through a portal to <body> so it escapes any transformed / z-indexed ancestor and its
// high z-index reliably stacks above the header panels (which sit at z-50 — this dialog is z-100 so
// it also clears the mobile sheets that a confirm can be triggered from).
//
// Presentation splits on breakpoint: DESKTOP is a centered card; MOBILE is a bottom action-sheet
// (grab handle + swipe-down-to-dismiss, matching every other mobile sheet). Both keep the same
// Cancel/Confirm buttons and Escape/scrim → cancel; a downward swipe on mobile is another cancel.

export type ConfirmTone = 'default' | 'danger'

export interface ConfirmOptions {
  /** Heading — a short question, e.g. `Delete the habit "Stretch"?`. */
  title: string
  /** Optional supporting line under the title. */
  message?: ReactNode
  /** Confirm button label. Defaults to `Delete` when tone is `danger`, else `Confirm`. */
  confirmLabel?: string
  /** Cancel button label. Defaults to `Cancel`. */
  cancelLabel?: string
  /** `danger` paints the confirm button red for destructive actions. Defaults to `danger`,
   *  since a confirm gate almost always guards a destructive action. */
  tone?: ConfirmTone
}

interface ConfirmDialogProps extends ConfirmOptions {
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  // Mobile: a downward swipe on the handle OR anywhere on the action sheet cancels (same as
  // scrim/Escape/Back). Active only on the mobile sheet — the desktop dialog doesn't slide.
  const swipe = useSwipeDismiss(onCancel, panelRef, isMobile)

  // Focus the confirm button on open (the user reached here through an explicit action) and wire
  // a document-level Escape → cancel, matching the app's other modals.
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const confirmText = confirmLabel ?? (tone === 'danger' ? 'Delete' : 'Confirm')
  const confirmClasses =
    tone === 'danger'
      ? 'bg-danger text-white hover:opacity-90'
      : 'bg-primary text-white hover:opacity-90'

  // Title + message + the Cancel/Confirm row — identical on both surfaces.
  const body = (
    <>
      <h2 className="font-serif text-lg font-semibold text-ink">{title}</h2>
      {message && <p className="mt-1.5 text-sm text-muted">{message}</p>}

      <div className="mt-5 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-4 py-2 text-sm font-medium text-muted hover:text-ink"
        >
          {cancelLabel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className={`rounded-full px-5 py-2 text-sm font-medium disabled:opacity-50 ${confirmClasses}`}
        >
          {confirmText}
        </button>
      </div>
    </>
  )

  // Mobile: a bottom action-sheet — grab handle + swipe-down cancels; scrim fades with the drag.
  if (isMobile) {
    return createPortal(
      <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={onCancel}>
        <div
          aria-hidden
          className="bottom-sheet-scrim absolute inset-0 bg-ink/40"
          style={swipe.dragging ? { opacity: 1 - swipe.progress } : undefined}
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          data-dragging={swipe.dragging ? 'true' : undefined}
          onClick={(e) => e.stopPropagation()}
          className="bottom-sheet-panel relative w-full max-w-md rounded-t-2xl border border-border-strong bg-panel px-5 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))] pt-2 shadow-xl"
          style={swipe.offset ? { transform: `translateY(${swipe.offset}px)` } : undefined}
        >
          <div
            data-testid="sheet-grabber"
            data-sheet-handle
            onPointerDown={swipe.onPointerDown}
            className="cursor-grab touch-none select-none"
          >
            <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-border-strong" />
          </div>
          {body}
        </div>
      </div>,
      document.body,
    )
  }

  // Desktop: the centered card (unchanged).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border-strong bg-panel p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>,
    document.body,
  )
}
