import { useCallback, useEffect, useRef, useState } from 'react'

// Free-canvas drag primitive — raw Pointer Events (chosen in ADR-0004).
// One handler set covers mouse, touch, and pen. Drives every drag consumer:
// grid card reposition, staging-tray → grid placement, and cluster-popup drag-out.
// (Mobile tap-to-place is a separate, simpler interaction the surface handles directly.)

export interface NormalizedPoint {
  /** urgency, 0 (left) → 1 (right) */
  x: number
  /** importance, 0 (bottom) → 1 (top) — INVERTED from screen-y */
  y: number
}

// Matches EisenClaw's placeAt clamp (planner.html). Cards stay just inside the edges.
export const DEFAULT_MIN = 0.03
export const DEFAULT_MAX = 0.97

const clampTo = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export interface SurfaceRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Screen point → normalized free-canvas coordinates within `rect`.
 * x grows left→right; **y is inverted** so the top of the surface is y=1 (the importance
 * axis, matching the grid's data-space). Both axes are clamped to [min, max]. Pure — no DOM,
 * so it is unit-testable in isolation (this is where the y-inversion + clamp logic lives).
 */
export function toNormalized(
  rect: SurfaceRect,
  clientX: number,
  clientY: number,
  min: number = DEFAULT_MIN,
  max: number = DEFAULT_MAX,
): NormalizedPoint {
  return {
    x: clampTo((clientX - rect.left) / rect.width, min, max),
    y: clampTo(1 - (clientY - rect.top) / rect.height, min, max),
  }
}

export interface UseFreeDragOptions {
  /** Element defining the coordinate space (the grid surface). */
  surfaceRef: React.RefObject<HTMLElement | null>
  /** Fired once on pointer-up, only if the pointer actually moved (a real drag, not a click). */
  onDrop: (id: string, point: NormalizedPoint) => void
  /** Optional: fired on every move during a drag (e.g. to render a live ghost). */
  onMove?: (id: string, point: NormalizedPoint) => void
  min?: number
  max?: number
}

export interface FreeDrag {
  /** id of the item currently being dragged, or null. */
  draggingId: string | null
  /**
   * Returns a pointer-down handler for a draggable element. The element must set
   * `touch-action: none` (CSS) so touch-drag isn't stolen by scrolling.
   */
  startDrag: (id: string) => (event: React.PointerEvent) => void
}

export function useFreeDrag({
  surfaceRef,
  onDrop,
  onMove,
  min,
  max,
}: UseFreeDragOptions): FreeDrag {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Hold the latest callbacks/options so the pointer listeners never go stale and we
  // don't rebind them on every render. Updated in an effect (not during render) so the
  // first drag after a prop change still sees fresh values.
  const latest = useRef({ onDrop, onMove, min, max })
  useEffect(() => {
    latest.current = { onDrop, onMove, min, max }
  })

  const startDrag = useCallback(
    (id: string) => (event: React.PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setDraggingId(id)
      let moved = false

      const compute = (e: PointerEvent): NormalizedPoint | null => {
        const rect = surfaceRef.current?.getBoundingClientRect()
        if (!rect) return null
        return toNormalized(rect, e.clientX, e.clientY, latest.current.min, latest.current.max)
      }

      const handleMove = (e: PointerEvent): void => {
        moved = true
        const point = compute(e)
        if (point) latest.current.onMove?.(id, point)
      }

      const handleUp = (e: PointerEvent): void => {
        const point = compute(e)
        if (moved && point) latest.current.onDrop(id, point)
        setDraggingId(null)
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleUp)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleUp)
    },
    [surfaceRef],
  )

  return { draggingId, startDrag }
}
