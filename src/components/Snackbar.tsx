import { createPortal } from 'react-dom'

// Snackbar — a small transient confirmation pill, floated above the mobile bottom nav (mobile
// audit §4.2: adding a task from the ➕ sheet gave zero feedback when the task landed in a
// quadrant you weren't looking at). Presentational: the caller owns the message state and its
// auto-dismiss timer (see AppShell's showToast). The aria-live region is ALWAYS mounted so screen
// readers announce message changes; visually nothing renders while `message` is null.
//
// pointer-events-none end to end — a toast must never block taps on the content behind it. The
// entrance reuses the existing `babyclaw-flash` keyframe, whose reduced-motion guard in index.css
// (`[style*='babyclaw-flash'] { animation: none }`) already neutralizes it.

export function Snackbar({ message }: { message: string | null }) {
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center"
      style={{ bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}
    >
      {message && (
        <span
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white shadow-lg"
          style={{ animation: 'babyclaw-flash 180ms ease-out' }}
        >
          {message}
        </span>
      )}
    </div>,
    document.body,
  )
}
