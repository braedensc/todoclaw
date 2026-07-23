import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_BOUNDS,
  toNormalized,
  type ClampBounds,
  type NormalizedPoint,
  type SurfaceRect,
} from '../../hooks/use-free-drag'

/** How long a press must hold still before the chip lifts into a drag. */
export const HOLD_MS = 250
/** Movement past this before the hold fires abandons the lift (a stray swipe, not a press). */
export const HOLD_SLOP_PX = 10
/**
 * Once lifted AND moving, the chip rides this many px ABOVE the finger so it is never occluded
 * (the industry finger-offset pattern) — and the DROP commits at the chip, not the finger.
 */
export const LIFT_OFFSET_PX = 56

export interface UseHoldDragOptions {
  /** Element defining the coordinate space (the touch grid's safe-area canvas). */
  surfaceRef: React.RefObject<HTMLElement | null>
  /** Clamp bounds from the LIVE surface rect (chip half-extents), like useFreeDrag's `clamp`. */
  clamp?: (rect: SurfaceRect) => ClampBounds
  /** Fired on release after a lift that actually moved — commit the new position. */
  onDrop: (id: string, point: NormalizedPoint) => void
  /** Fired on release BEFORE the hold fires (a plain tap — open the sheet). */
  onTap: (id: string) => void
  /** Fired once when the hold fires and the chip lifts (haptic + visual hooks). */
  onLift?: (id: string) => void
  /** Fired on every post-lift move with the offset-corrected point (paint ghost/crosshairs). */
  onFrame?: (id: string, point: NormalizedPoint) => void
  /** Fired when a lift ends for ANY reason (drop, cancel, Escape) — clear painted affordances. */
  onLiftEnd?: (id: string) => void
}

export interface HoldDrag {
  /** id of the chip currently lifted, or null. */
  draggingId: string | null
  /** Pointer-down handler for a draggable chip. The chip must set `touch-action: none`. */
  startHold: (id: string) => (event: React.PointerEvent) => void
}

/**
 * Touch-first drag for the fullscreen grid (TouchGridSurface): press-and-HOLD lifts the chip
 * (useFreeDrag's press-and-move model steals taps and gives no affordance on touch — hold-to-
 * lift is the pattern iOS home screens train), then the chip rides ~56px above the finger and
 * release drops it there. The gesture grammar:
 *
 *   release before the hold fires        → tap (onTap — the sheet)
 *   move > HOLD_SLOP_PX before it fires  → dead gesture (neither tap nor drag)
 *   hold → lift → move → release         → onDrop at the offset-corrected point
 *   hold → lift → release without moving → no-op (the chip settles back; nothing writes)
 *   pointercancel / Escape               → abort, nothing writes
 *
 * Window-level listeners + latest-ref callbacks mirror useFreeDrag; the Escape listener runs on
 * document CAPTURE with stopPropagation so aborting a drag never also exits grid-only (App's
 * Esc handler listens on window bubble).
 */
export function useHoldDrag({
  surfaceRef,
  clamp,
  onDrop,
  onTap,
  onLift,
  onFrame,
  onLiftEnd,
}: UseHoldDragOptions): HoldDrag {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const latest = useRef({ clamp, onDrop, onTap, onLift, onFrame, onLiftEnd })
  useEffect(() => {
    latest.current = { clamp, onDrop, onTap, onLift, onFrame, onLiftEnd }
  })

  const startHold = useCallback(
    (id: string) => (event: React.PointerEvent) => {
      // No isPrimary guard, deliberately: React polyfills isPrimary to FALSE on events whose
      // native type lacks the field (jsdom's MouseEvent fallback), which would kill every
      // gesture under test — and useFreeDrag has shipped without one all along. Multi-touch
      // second fingers are as unhandled here as they are on the desktop grid.
      event.preventDefault()
      event.stopPropagation()
      const startX = event.clientX
      const startY = event.clientY
      let lifted = false
      let dead = false
      let movedSinceLift = false
      let lastPoint: NormalizedPoint | null = null

      const compute = (clientX: number, clientY: number): NormalizedPoint | null => {
        const rect = surfaceRef.current?.getBoundingClientRect()
        if (!rect) return null
        const bounds = latest.current.clamp?.(rect) ?? DEFAULT_BOUNDS
        // The chip rides LIFT_OFFSET_PX above the finger — commit where the chip is, not where
        // the finger is (toNormalized clamps, so dragging near the top edge stays on-board).
        return toNormalized(rect, clientX, clientY - LIFT_OFFSET_PX, bounds)
      }

      const holdTimer = window.setTimeout(() => {
        if (dead) return
        lifted = true
        setDraggingId(id)
        latest.current.onLift?.(id)
      }, HOLD_MS)

      const finishLift = (): void => {
        if (lifted) latest.current.onLiftEnd?.(id)
      }

      const cleanup = (): void => {
        window.clearTimeout(holdTimer)
        setDraggingId(null)
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
        document.removeEventListener('keydown', handleKey, true)
      }

      const handleMove = (e: PointerEvent): void => {
        if (!lifted) {
          // Real movement before the hold fires means this was never a deliberate press —
          // abandon the pending lift; release will be a dead gesture, not a tap.
          if (Math.hypot(e.clientX - startX, e.clientY - startY) > HOLD_SLOP_PX) dead = true
          return
        }
        movedSinceLift = true
        const point = compute(e.clientX, e.clientY)
        if (point) {
          lastPoint = point
          latest.current.onFrame?.(id, point)
        }
      }

      const handleUp = (): void => {
        if (lifted) {
          // A lift that never moved is a no-op — the chip settles back where it was; writing
          // here would hop the task LIFT_OFFSET_PX up on every long-press-and-release.
          if (movedSinceLift && lastPoint) latest.current.onDrop(id, lastPoint)
          finishLift()
        } else if (!dead) {
          latest.current.onTap(id)
        }
        cleanup()
      }

      const handleCancel = (): void => {
        finishLift()
        cleanup()
      }

      // Escape aborts the drag (or the pending hold). Capture phase + stopPropagation so the
      // same keypress can't ALSO reach App's window-level grid-only exit.
      const handleKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        finishLift()
        cleanup()
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
      document.addEventListener('keydown', handleKey, true)
    },
    [surfaceRef],
  )

  return { draggingId, startHold }
}
