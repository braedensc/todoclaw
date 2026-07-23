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

// ---- Touch hold-to-lift constants (canonical home; use-hold-drag re-exports them). ----
/** How long a press must hold still before a `holdToLift` drag lifts. */
export const HOLD_MS = 250
/**
 * Movement tolerance around a hold: bigger pre-lift kills the pending lift (a swipe, not a
 * press), and post-lift it is the floor below which "movement" is finger jitter — real fingers
 * wobble 1-5px while holding still, and without the post-lift floor a stationary long-press
 * would commit a phantom reposition (touch-grid drag review).
 */
export const HOLD_SLOP_PX = 10
/**
 * Once lifted AND moving, the dragged item rides this many px ABOVE the finger so it is never
 * occluded (the finger-offset pattern) — and the drop commits at the ITEM, not the finger.
 */
export const LIFT_OFFSET_PX = 56

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
  /**
   * TOUCH mode (the iPad hybrid, ADR-0028 workshop PR 4): a press must HOLD for HOLD_MS before
   * it lifts into a drag — a quick release is a tap (onTap), a swipe past HOLD_SLOP_PX before
   * the hold fires is a dead gesture, and once lifted the item rides LIFT_OFFSET_PX above the
   * finger (drop commits at the item). Mutually exclusive with `activateOnMove`. Carries the
   * touch-gesture discipline the fullscreen grid's use-hold-drag pioneered: post-lift jitter
   * inside the slop is NOT a move, only the starting pointerId steers/ends the gesture, one
   * gesture at a time, and Escape aborts without the keypress reaching window listeners.
   */
  holdToLift?: boolean
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
  holdToLift,
}: UseFreeDragOptions): FreeDrag {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // holdToLift only: one gesture at a time — a second finger pressing another card must not
  // install a second competing listener set (touch-grid drag review).
  const holdActiveRef = useRef(false)
  // Hold the latest callbacks/options so the pointer listeners never go stale and we
  // don't rebind them on every render. Updated in an effect (not during render) so the
  // first drag after a prop change still sees fresh values.
  const latest = useRef({ onDrop, onMove, onDragStart, onTap, clamp, activateOnMove, holdToLift })
  useEffect(() => {
    latest.current = { onDrop, onMove, onDragStart, onTap, clamp, activateOnMove, holdToLift }
  })

  const startDrag = useCallback(
    (id: string) => (event: React.PointerEvent) => {
      const hold = latest.current.holdToLift === true
      if (hold && holdActiveRef.current) return
      event.preventDefault()
      event.stopPropagation()
      if (hold) holdActiveRef.current = true
      // holdToLift only: the finger that started the gesture is the only one that may steer or
      // end it. (undefined === undefined keeps jsdom's field-less synthesized events flowing.)
      const pointerId = event.pointerId
      const samePointer = (e: PointerEvent): boolean => !hold || e.pointerId === pointerId
      const startX = event.clientX
      const startY = event.clientY
      let moved = false
      let lifted = !hold // pointer modes are "lifted" from the start; hold mode earns it
      let dead = false
      // Eager consumers (grid reposition / new-item placement) lift the item on pointer-down so
      // its standalone card renders under the pointer from the first frame. Deferred consumers
      // (activateOnMove) and hold mode wait, so a plain tap never pulls the item.
      if (!latest.current.activateOnMove && !hold) setDraggingId(id)

      const holdTimer = hold
        ? window.setTimeout(() => {
            if (dead) return
            lifted = true
            setDraggingId(id)
            latest.current.onDragStart?.(id)
          }, HOLD_MS)
        : 0

      const compute = (e: PointerEvent): NormalizedPoint | null => {
        const rect = surfaceRef.current?.getBoundingClientRect()
        if (!rect) return null
        const bounds = latest.current.clamp?.(rect) ?? DEFAULT_BOUNDS
        // In hold mode a lifted item rides LIFT_OFFSET_PX above the finger — commit where the
        // ITEM is, not where the finger is (toNormalized clamps, so the top edge stays on-board).
        const offset = hold && lifted ? LIFT_OFFSET_PX : 0
        return toNormalized(rect, e.clientX, e.clientY - offset, bounds)
      }

      const handleMove = (e: PointerEvent): void => {
        if (!samePointer(e)) return
        const travel = Math.hypot(e.clientX - startX, e.clientY - startY)
        if (hold && !lifted) {
          // Real movement before the hold fires means this was never a deliberate press —
          // abandon the pending lift; release will be a dead gesture, not a tap.
          if (travel > HOLD_SLOP_PX) dead = true
          return
        }
        if (!moved) {
          // A press only becomes a drag once it travels past the threshold — below that it is a
          // tap (pointer modes) or settle-back jitter (hold mode: real fingers wobble a few px
          // during a "stationary" lift; without the floor a long-press would commit a phantom
          // reposition LIFT_OFFSET_PX up).
          const floor = hold ? HOLD_SLOP_PX : DRAG_THRESHOLD_PX
          if (travel < floor) return
          moved = true
          if (latest.current.activateOnMove) setDraggingId(id)
          if (!hold) latest.current.onDragStart?.(id)
        }
        const point = compute(e)
        if (point) latest.current.onMove?.(id, point)
      }

      const cleanup = (): void => {
        window.clearTimeout(holdTimer)
        holdActiveRef.current = false
        setDraggingId(null)
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
        if (hold) document.removeEventListener('keydown', handleKey, true)
      }

      const handleUp = (e: PointerEvent): void => {
        if (!samePointer(e)) return
        if (moved && lifted) {
          const point = compute(e)
          if (point) latest.current.onDrop(id, point)
        } else if (!dead && !(hold && lifted)) {
          // A quick release is a tap. A hold-lift released WITHOUT moving is a deliberate
          // no-op (the item settles back) — neither a drop nor a tap.
          latest.current.onTap?.(id)
        }
        cleanup()
      }

      // A cancelled press (browser gesture, etc.) is neither a drop nor a tap — just tear down.
      const handleCancel = (e: PointerEvent): void => {
        if (!samePointer(e)) return
        cleanup()
      }

      // Hold mode only: Escape aborts the drag (or the pending hold). Capture phase +
      // stopPropagation so the same keypress can't ALSO reach window-level listeners
      // (the grid-only Esc exit).
      const handleKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        cleanup()
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
      if (hold) document.addEventListener('keydown', handleKey, true)
    },
    [surfaceRef],
  )

  return { draggingId, startDrag }
}
