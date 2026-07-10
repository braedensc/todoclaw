import { useCallback, useEffect, useRef, useState } from 'react'

// Swipe-down-to-dismiss for slide-up sheets — the standard iOS/Android sheet gesture. Two input
// paths cover how people actually dismiss:
//
//  1. HANDLE (pointer events): the grab handle / header region wires `onPointerDown` and sets
//     `touch-action: none` (CSS), so a drag starting there — mouse, touch, or pen — always drives
//     the sheet. This was the original (#166) surface.
//  2. WHOLE PANEL (touch events): in practice people swipe the sheet BODY, not a 16px handle
//     strip — the audit-feedback round found the gesture "not working" for exactly that reason.
//     While `active`, the hook binds touch listeners on the panel itself: a downward drag ENGAGES
//     the dismiss when it starts somewhere that isn't (a) the handle (the pointer path owns it),
//     (b) a text control (native selection/caret behavior stays intact), or (c) inside a scroller
//     that is scrolled down (it can still scroll up — the scroller owns that gesture). A scroller
//     resting at the top hands a downward pull to the sheet — the native bottom-sheet feel.
//     Engagement needs > SLOP_PX of downward travel; from then on touchmove is preventDefault-ed
//     (listener is passive: false) so the browser can't rubber-band or scroll mid-drag. Upward
//     intent never engages — content scrolling up stays native. Mouse drags on the body are
//     deliberately NOT captured (desktop text selection would break); the handle covers mouse.
//
// Release semantics (both paths): a DELIBERATE pull dismisses — past ~⅓ of the sheet height or
// 140px (whichever is smaller), OR a fast downward flick that ALSO covers at least 56px. A quick
// tiny nudge — the reflex you make scrolling to re-read a message — is NOT a dismiss (speed alone
// used to close it, which felt hair-trigger). Otherwise the panel springs back to 0 (the CSS
// transition on `.bottom-sheet-panel`, disabled while `data-dragging` so tracking is 1:1).
//
// prefers-reduced-motion: the follow animation is skipped (the panel never translates with the
// finger) but the dismiss itself still works — matching how the sheet keyframes are neutralized
// in index.css.

/** Absolute distance (px) a downward drag must travel to dismiss (upper bound; see below). */
const DISMISS_DISTANCE_PX = 140
/** …or this fraction of the sheet's own height, whichever is smaller (tall sheets dismiss sooner). */
const DISMISS_HEIGHT_FRACTION = 1 / 3
/** A downward flick faster than this (px/ms) can dismiss — but only paired with FLICK_MIN_DISTANCE_PX
 *  below. Speed alone used to dismiss at ANY distance, which fired on a quick scroll-to-read nudge. */
const FLICK_VELOCITY_PX_PER_MS = 0.5
/** …and a flick must ALSO travel at least this far to count. A fast-but-tiny motion is a scroll, not
 *  a close — this is the main knob that makes the gesture "only trigger when you mean it". */
const FLICK_MIN_DISTANCE_PX = 56
/** Downward travel (px) before a body-touch commits to dragging the sheet (vs. a tap / scroll).
 *  Raised 8 → 14 so a small finger movement stays a scroll/tap and never nudges the sheet open. */
const SLOP_PX = 14

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
  /** pointerdown handler for the drag handle / header (mark that region `data-sheet-handle`). */
  onPointerDown: (event: React.PointerEvent) => void
}

/**
 * Wire swipe-down-to-dismiss onto a sheet. Attach the returned `onPointerDown` to the grab
 * handle/header (with `touch-action: none` and `data-sheet-handle` so the panel-level touch path
 * skips it), apply `translateY(offset)` + `data-dragging` to the panel; `onDismiss` is invoked for
 * you when a gesture crosses the threshold or flicks down.
 *
 * `panelRef` is both the whole-panel touch-drag surface and the height source for the fractional
 * threshold / scrim progress. `active` gates the panel listeners — pass the sheet's `open` when
 * the panel mounts conditionally (the effect re-binds as it flips).
 */
export function useSwipeDismiss(
  onDismiss: () => void,
  panelRef: React.RefObject<HTMLElement | null>,
  active = true,
): SwipeDismiss {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  // Hold the latest onDismiss so the listeners never go stale and we don't rebind them on every
  // render. Updated in an effect (not during render) so the first drag after a prop change still
  // sees a fresh value — the same pattern as use-free-drag.
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  })

  // ── Path 1: the handle (pointer events — mouse, touch, or pen) ─────────────────────────────
  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Only the primary button/contact starts a dismiss-drag (ignore right-click / secondary touch).
      if (event.button != null && event.button !== 0) return
      event.preventDefault()
      const reduced = prefersReducedMotion()
      const startY = event.clientY
      const height = panelRef.current?.getBoundingClientRect().height ?? 0
      // Two-sample history so release velocity is measured across the LAST movement (a single
      // "last sample" would always equal the release position → velocity 0, no flick).
      let lastY = startY
      let lastT = event.timeStamp
      let prevY = startY
      let prevT = event.timeStamp

      setDragging(true)

      const handleMove = (e: PointerEvent): void => {
        // Downward only; an upward pull just rests at 0 (the sheet can't be dragged above its home).
        const dy = Math.max(0, e.clientY - startY)
        prevY = lastY
        prevT = lastT
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
        const dt = e.timeStamp - prevT
        const velocity = dt > 0 ? (e.clientY - prevY) / dt : 0
        const distanceThreshold =
          height > 0
            ? Math.min(DISMISS_DISTANCE_PX, height * DISMISS_HEIGHT_FRACTION)
            : DISMISS_DISTANCE_PX
        const flicked = velocity >= FLICK_VELOCITY_PX_PER_MS && dy >= FLICK_MIN_DISTANCE_PX
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

  // ── Path 2: the whole panel (touch events, scroll-aware) ───────────────────────────────────
  useEffect(() => {
    if (!active) return
    const panel = panelRef.current
    if (!panel) return
    const reduced = prefersReducedMotion()

    // Per-gesture state (one active touch drag at a time).
    let startY = 0
    let lastY = 0
    let lastT = 0
    let prevY = 0
    let prevT = 0
    let height = 0
    let engaged = false
    let blocked = true

    const findScrollableAncestor = (node: Element | null): Element | null => {
      let el = node
      while (el && el !== panel) {
        const cs = getComputedStyle(el)
        if (
          (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 1
        ) {
          return el
        }
        el = el.parentElement
      }
      return null
    }

    const onTouchStart = (e: TouchEvent): void => {
      blocked = true
      engaged = false
      if (e.touches.length !== 1) return
      const target = e.target as Element | null
      // The handle already drives the pointer path — don't double-track the same gesture.
      if (target?.closest('[data-sheet-handle]')) return
      // Text controls keep native caret/selection touch behavior.
      if (target?.closest('input, textarea, select')) return
      // A scroller that's scrolled down owns the gesture (it can scroll back up). At the top,
      // a downward pull belongs to the sheet.
      const scroller = findScrollableAncestor(target)
      if (scroller && scroller.scrollTop > 0) return
      const t = e.touches[0]
      if (!t) return
      blocked = false
      startY = lastY = prevY = t.clientY
      lastT = prevT = e.timeStamp
      height = panel.getBoundingClientRect().height
    }

    const onTouchMove = (e: TouchEvent): void => {
      if (blocked) return
      const t = e.touches[0]
      if (!t) return
      const dy = t.clientY - startY
      if (!engaged) {
        // Upward intent = content scroll; never the sheet's gesture.
        if (dy < -SLOP_PX) {
          blocked = true
          return
        }
        if (dy < SLOP_PX) return
        engaged = true
        setDragging(true)
      }
      // Ours now: stop the scroller/rubber-band from fighting the drag.
      e.preventDefault()
      prevY = lastY
      prevT = lastT
      lastY = t.clientY
      lastT = e.timeStamp
      if (reduced) return
      const off = Math.max(0, dy)
      setOffset(off)
      setProgress(height > 0 ? Math.min(1, off / height) : 0)
    }

    const settle = (): void => {
      engaged = false
      blocked = true
      setDragging(false)
      setOffset(0)
      setProgress(0)
    }

    const onTouchEnd = (e: TouchEvent): void => {
      if (!engaged) return
      const t = e.changedTouches[0]
      const endY = t ? t.clientY : lastY
      const dy = Math.max(0, endY - startY)
      const dt = e.timeStamp - prevT
      const velocity = dt > 0 ? (endY - prevY) / dt : 0
      const distanceThreshold =
        height > 0
          ? Math.min(DISMISS_DISTANCE_PX, height * DISMISS_HEIGHT_FRACTION)
          : DISMISS_DISTANCE_PX
      settle()
      const flicked = velocity >= FLICK_VELOCITY_PX_PER_MS && dy >= FLICK_MIN_DISTANCE_PX
      if (dy >= distanceThreshold || flicked) dismissRef.current()
    }

    const onTouchCancel = (): void => {
      if (engaged) settle()
      else blocked = true
    }

    panel.addEventListener('touchstart', onTouchStart, { passive: true })
    // passive: false — engagement must be able to preventDefault the scroll.
    panel.addEventListener('touchmove', onTouchMove, { passive: false })
    panel.addEventListener('touchend', onTouchEnd)
    panel.addEventListener('touchcancel', onTouchCancel)
    return () => {
      panel.removeEventListener('touchstart', onTouchStart)
      panel.removeEventListener('touchmove', onTouchMove)
      panel.removeEventListener('touchend', onTouchEnd)
      panel.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [active, panelRef])

  return { offset, dragging, progress, onPointerDown }
}
