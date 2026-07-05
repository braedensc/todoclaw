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

// Legacy EisenClaw placeAt clamp — a flat 3% margin on both axes (planner.html). Kept as the
// default; grid consumers now pass a size-aware `clamp` so a card/bubble's whole bounding box
// stays inside the surface (item 17) instead of just its centre.
export const DEFAULT_MIN = 0.03
export const DEFAULT_MAX = 0.97

const clampTo = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export interface SurfaceRect {
  left: number
  top: number
  width: number
  height: number
}

/** Per-axis normalized clamp bounds (may differ by axis once card/bubble size is factored in). */
export interface ClampBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** The flat 3% margin, as a ClampBounds — the default when a consumer supplies no size-aware clamp. */
export const DEFAULT_BOUNDS: ClampBounds = {
  minX: DEFAULT_MIN,
  maxX: DEFAULT_MAX,
  minY: DEFAULT_MIN,
  maxY: DEFAULT_MAX,
}

/**
 * Clamp bounds that keep a box of the given PIXEL half-extents fully inside a surface of `size`
 * px. The margin on each axis is `halfExtent / dimension`, so a 112px card near the left edge is
 * held far enough in that its ~56px half-width never crosses the edge (and the grid's
 * `overflow-hidden` can't clip it — item 17). Because the margin tracks the LIVE surface size, it
 * shrinks/grows with the grid (which reflows with the chat push-drawer). Guards: an unmeasured
 * (0px) surface falls back to the flat default, and the margin is capped below 0.5 so a very
 * narrow surface can't invert the bounds.
 */
export function boxClampBounds(
  size: { width: number; height: number },
  halfW: number,
  halfH: number,
): ClampBounds {
  const mx = size.width > 0 ? Math.min(halfW / size.width, 0.49) : DEFAULT_MIN
  const my = size.height > 0 ? Math.min(halfH / size.height, 0.49) : DEFAULT_MIN
  return { minX: mx, maxX: 1 - mx, minY: my, maxY: 1 - my }
}

/** Clamp an already-normalized point into `bounds` — used to re-clamp stored coords at render time. */
export function clampPoint(x: number, y: number, bounds: ClampBounds): NormalizedPoint {
  return { x: clampTo(x, bounds.minX, bounds.maxX), y: clampTo(y, bounds.minY, bounds.maxY) }
}

/**
 * Screen point → normalized free-canvas coordinates within `rect`.
 * x grows left→right; **y is inverted** so the top of the surface is y=1 (the importance
 * axis, matching the grid's data-space). Both axes are clamped to `bounds`. Pure — no DOM,
 * so it is unit-testable in isolation (this is where the y-inversion + clamp logic lives).
 */
export function toNormalized(
  rect: SurfaceRect,
  clientX: number,
  clientY: number,
  bounds: ClampBounds = DEFAULT_BOUNDS,
): NormalizedPoint {
  return {
    x: clampTo((clientX - rect.left) / rect.width, bounds.minX, bounds.maxX),
    y: clampTo(1 - (clientY - rect.top) / rect.height, bounds.minY, bounds.maxY),
  }
}

/** Pixels the pointer must travel before a press becomes a drag; below this it's a tap/click. */
export const DRAG_THRESHOLD_PX = 4

export interface UseFreeDragOptions {
  /** Element defining the coordinate space (the grid surface). */
  surfaceRef: React.RefObject<HTMLElement | null>
  /** Fired once on pointer-up, only if the pointer actually moved (a real drag, not a click). */
  onDrop: (id: string, point: NormalizedPoint) => void
  /** Optional: fired on every move during a drag (e.g. to render a live ghost). */
  onMove?: (id: string, point: NormalizedPoint) => void
  /** Optional: fired once when a press crosses the threshold and becomes a real drag. */
  onDragStart?: (id: string) => void
  /** Optional: fired on pointer-up when the press never became a drag (a plain tap/click). */
  onTap?: (id: string) => void
  /**
   * Optional: compute the clamp bounds for this drag from the LIVE surface rect, so a sized
   * element's whole bounding box stays inside (item 17). Defaults to the flat 3% margin.
   */
  clamp?: (rect: SurfaceRect) => ClampBounds
  /**
   * Defer marking the item "dragging" until the press becomes a real drag (past threshold),
   * instead of on pointer-down. Needed where a bare press must NOT visually pull the item — the
   * cluster-popup row, where a tap edits in place and only a drag tears the card onto the grid.
   */
  activateOnMove?: boolean
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
  onDragStart,
  onTap,
  clamp,
  activateOnMove,
}: UseFreeDragOptions): FreeDrag {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Hold the latest callbacks/options so the pointer listeners never go stale and we
  // don't rebind them on every render. Updated in an effect (not during render) so the
  // first drag after a prop change still sees fresh values.
  const latest = useRef({ onDrop, onMove, onDragStart, onTap, clamp, activateOnMove })
  useEffect(() => {
    latest.current = { onDrop, onMove, onDragStart, onTap, clamp, activateOnMove }
  })

  const startDrag = useCallback(
    (id: string) => (event: React.PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const startX = event.clientX
      const startY = event.clientY
      let moved = false
      // Eager consumers (grid reposition / new-item placement) lift the item on pointer-down so
      // its standalone card renders under the pointer from the first frame. Deferred consumers
      // (activateOnMove) wait for real movement so a plain tap never pulls the item.
      if (!latest.current.activateOnMove) setDraggingId(id)

      const compute = (e: PointerEvent): NormalizedPoint | null => {
        const rect = surfaceRef.current?.getBoundingClientRect()
        if (!rect) return null
        const bounds = latest.current.clamp?.(rect) ?? DEFAULT_BOUNDS
        return toNormalized(rect, e.clientX, e.clientY, bounds)
      }

      const handleMove = (e: PointerEvent): void => {
        if (!moved) {
          // A press only becomes a drag once it travels past the threshold — below that it is a
          // tap (jitter of a click), so we ignore it and let handleUp fire onTap.
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return
          moved = true
          if (latest.current.activateOnMove) setDraggingId(id)
          latest.current.onDragStart?.(id)
        }
        const point = compute(e)
        if (point) latest.current.onMove?.(id, point)
      }

      const cleanup = (): void => {
        setDraggingId(null)
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
      }

      const handleUp = (e: PointerEvent): void => {
        if (moved) {
          const point = compute(e)
          if (point) latest.current.onDrop(id, point)
        } else {
          latest.current.onTap?.(id)
        }
        cleanup()
      }

      // A cancelled press (browser gesture, etc.) is neither a drop nor a tap — just tear down.
      const handleCancel = (): void => cleanup()

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
    },
    [surfaceRef],
  )

  return { draggingId, startDrag }
}
