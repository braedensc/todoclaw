import { useCallback, useEffect, useRef, useState } from 'react'

// Swipe-down-to-dismiss for slide-up sheets — the standard iOS/Android sheet gesture: drag the grab
// handle/header down and the panel's translateY follows the finger; release past a threshold (~⅓ of
// the sheet height or ~120px, whichever is smaller) OR with a fast downward flick and the sheet
// dismisses; otherwise it springs back to 0. Built on the same raw Pointer Events pattern as
// use-free-drag (pointerdown on the handle → pointermove/up/cancel on window), so one handler set
// covers touch, mouse, and pen. The handle element must set `touch-action: none` (CSS) so the
// browser doesn't steal the touch-drag for scrolling; content scrolling inside the sheet body is
// untouched because only the handle wires this up.
//
// prefers-reduced-motion: we skip the follow animation (the panel never translates with the finger)
// but keep the instant dismiss — a downward drag past the threshold still closes. This mirrors how
// the sheet keyframes are neutralized in index.css.

/** Absolute distance (px) a downward drag must travel to dismiss (upper bound; see below). */
const DISMISS_DISTANCE_PX = 120
/** …or this fraction of the sheet's own height, whichever is smaller (tall sheets dismiss sooner). */
const DISMISS_HEIGHT_FRACTION = 1 / 3
/** A downward flick faster than this (px/ms) dismisses regardless of distance travelled. */
const FLICK_VELOCITY_PX_PER_MS = 0.5

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export interface SwipeDismiss {
  /** translateY (px) to apply to the panel while dragging; 0 otherwise. Always 0 under reduced motion. */
  offset: number
  /** True while a drag is in progress — pair with a `data-dragging` attribute to disable the panel's
   *  CSS transition so it tracks the finger 1:1 (and re-enable it for the spring-back). */
  dragging: boolean
  /** Drag progress 0→1 (offset / sheet height), for optionally fading the scrim. */
  progress: number
  /** pointerdown handler for the drag handle / header. */
  onPointerDown: (event: React.PointerEvent) => void
}

/**
 * Wire swipe-down-to-dismiss onto a sheet. Attach the returned `onPointerDown` to the grab
 * handle/header (with `touch-action: none`), apply `translateY(offset)` + `data-dragging` to the
 * panel; `onDismiss` is invoked for you when the gesture crosses the threshold or flicks down.
 *
 * `panelRef` measures the sheet height at drag-start (for the fractional threshold + scrim progress);
 * an unmeasured panel falls back to the flat `DISMISS_DISTANCE_PX`.
 */
export function useSwipeDismiss(
  onDismiss: () => void,
  panelRef: React.RefObject<HTMLElement | null>,
): SwipeDismiss {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  // Hold the latest onDismiss so the pointer listeners never go stale and we don't rebind them on
  // every render. Updated in an effect (not during render) so the first drag after a prop change
  // still sees a fresh value — the same pattern as use-free-drag.
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  })

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Only the primary button/contact starts a dismiss-drag (ignore right-click / secondary touch).
      if (event.button != null && event.button !== 0) return
      event.preventDefault()
      const reduced = prefersReducedMotion()
      const startY = event.clientY
      const height = panelRef.current?.getBoundingClientRect().height ?? 0
      // Track the last sample to estimate release velocity for the flick shortcut.
      let lastY = startY
      let lastT = event.timeStamp

      setDragging(true)

      const handleMove = (e: PointerEvent): void => {
        // Downward only; an upward pull just rests at 0 (the sheet can't be dragged above its home).
        const dy = Math.max(0, e.clientY - startY)
        lastY = e.clientY
        lastT = e.timeStamp
        if (reduced) return
        setOffset(dy)
        setProgress(height > 0 ? Math.min(1, dy / height) : 0)
      }

      const cleanup = (): void => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
        setDragging(false)
        setOffset(0)
        setProgress(0)
      }

      const handleUp = (e: PointerEvent): void => {
        const dy = Math.max(0, e.clientY - startY)
        const dt = e.timeStamp - lastT
        const velocity = dt > 0 ? (e.clientY - lastY) / dt : 0
        const distanceThreshold =
          height > 0
            ? Math.min(DISMISS_DISTANCE_PX, height * DISMISS_HEIGHT_FRACTION)
            : DISMISS_DISTANCE_PX
        const flicked = velocity >= FLICK_VELOCITY_PX_PER_MS
        cleanup()
        if (dy >= distanceThreshold || flicked) dismissRef.current()
      }

      // A cancelled press (browser gesture, etc.) is not a dismiss — just spring back.
      const handleCancel = (): void => cleanup()

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
    },
    [panelRef],
  )

  return { offset, dragging, progress, onPointerDown }
}
