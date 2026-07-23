import { useEffect, useState } from 'react'

/** How long the pill lingers after a rotation before quietly getting out of the way. */
export const ROTATE_HINT_MS = 6000

/**
 * The rotate affordance from the touch-grid workshop: now that phones keep the MOBILE layout in
 * landscape (ADR 2026-07-23-phones-stay-mobile-in-landscape), turning the phone sideways is the
 * grid's natural home — this floating "▦ View grid" pill surfaces that door for a few seconds
 * after a rotation to landscape. Tap → grid view; rotate back or wait and it disappears.
 *
 * Trigger discipline (review-shaped): the pill fires ONLY on a `screen.orientation` change
 * EVENT — never on mount. screen.orientation reflects the physical DEVICE, so the iOS keyboard
 * shrinking the layout viewport can't fake a "rotation" the way an `(orientation: landscape)`
 * media query can (the standalone keyboard makes a short phone's viewport wider than tall —
 * the pill would pop over the composer mid-typing). Event-only also means remounts (exiting
 * grid view, returning to Home) never re-offer the door the user just walked out of, and it
 * self-limits to devices that rotate: desktop windows resize without orientation events, and
 * the coarse-pointer guard keeps narrow fine-pointer windows out entirely. No screen.orientation
 * (old engines, jsdom) → no pill; More → Grid view is always there.
 */
export function RotateGridHint({ onOpenGrid }: { onOpenGrid: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const orientation = window.screen?.orientation
    if (
      !orientation ||
      typeof window.matchMedia !== 'function' ||
      !window.matchMedia('(pointer: coarse)').matches
    ) {
      return
    }
    let timer = 0
    const onChange = () => {
      if (orientation.type.startsWith('landscape')) {
        setVisible(true)
        window.clearTimeout(timer)
        timer = window.setTimeout(() => setVisible(false), ROTATE_HINT_MS)
      } else {
        window.clearTimeout(timer)
        setVisible(false)
      }
    }
    orientation.addEventListener('change', onChange)
    return () => {
      orientation.removeEventListener('change', onChange)
      window.clearTimeout(timer)
    }
  }, [])

  if (!visible) return null
  return (
    // Above the bottom nav (its ~64px rows + safe-area bottom inset), below the z-50 sheet band
    // but over the nav's z-40 so the pill is never clipped behind the bar's blur.
    <button
      type="button"
      onClick={onOpenGrid}
      className="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[45] flex min-h-[44px] -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/40 bg-panel px-4 py-2 text-sm font-medium text-primary shadow-lg"
    >
      <span aria-hidden>▦</span> View grid
    </button>
  )
}
