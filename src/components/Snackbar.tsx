import { createPortal } from 'react-dom'

// Snackbar — a small transient pill, floated above the mobile bottom nav (mobile audit §4.2:
// adding a task from the ➕ sheet gave zero feedback when the task landed in a quadrant you weren't
// looking at). Presentational: the caller owns the message state and its auto-dismiss timer (see
// ToastProvider). The aria-live region is ALWAYS mounted so screen readers announce message
// changes; visually nothing renders while `message` is null.
//
// Two tones: 'default' is a plain confirmation (the "Added to X ✓" pill); 'error' carries a
// terracotta ⚠ and announces assertively — used by the shared task mutations' onError so a failed
// write shows a notice instead of looking like a silent no-op. Both keep the AA-contrast dark pill
// (white on `ink`); the tone differs by the leading glyph, not sub-AA colored text.
//
// pointer-events-none end to end — a toast must never block taps on the content behind it. The
// entrance reuses the existing `babyclaw-flash` keyframe, whose reduced-motion guard in index.css
// (`[style*='babyclaw-flash'] { animation: none }`) already neutralizes it.

export type ToastTone = 'default' | 'error'

export function Snackbar({
  message,
  tone = 'default',
}: {
  message: string | null
  tone?: ToastTone
}) {
  return createPortal(
    <div
      // Errors interrupt (assertive); confirmations wait their turn (polite).
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}
    >
      {message && (
        <span
          className="flex max-w-md items-center rounded-full bg-ink px-4 py-2 text-sm font-medium text-white shadow-lg"
          style={{ animation: 'babyclaw-flash 180ms ease-out' }}
        >
          {tone === 'error' && (
            <span aria-hidden className="mr-1.5 text-accent">
              ⚠
            </span>
          )}
          {message}
        </span>
      )}
    </div>,
    document.body,
  )
}
