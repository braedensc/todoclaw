import {
  Children,
  cloneElement,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

// Tooltip — the app's replacement for the native browser tooltip. Every icon control routes its
// label through here (via IconButton), so the whole app gets one warm-paper bubble that pops in
// ~180ms instead of the OS default (unstyleable, ~1s). It can wrap any single focusable/hoverable
// element, so non-IconButton chips that still carry a raw `title=` (e.g. GridCard's ⋯ menu) can be
// migrated the same way.
//
// Design choices that matter:
//   • No wrapper DOM. We `cloneElement` the single child and attach the ref + hover/focus handlers
//     directly, so the trigger stays the same element in the same layout slot (IconButton is used
//     inside flex rows and with `!h-6 !w-6` overrides — a wrapper would break those). Tooltip
//     claims the child's `ref` (for positioning), so the child must not also carry its own — none
//     of the icon controls do.
//   • Portaled to <body> with `position: fixed`, so it is never clipped by an `overflow` ancestor —
//     the cluster popup (`overflow-y-auto`) and the Done modal (`overflow-y-auto`) are the risky
//     spots, and a viewport-positioned portal escapes both.
//   • Positioned above the trigger, flipping below when it would clip the top of the viewport, and
//     clamped horizontally so it never runs off a screen edge.
//   • Accessible: `role="tooltip"` + `aria-describedby` (the trigger keeps its own `aria-label` as
//     its name, so the bubble is a supplementary description, not the sole label). Shows on hover
//     AND on keyboard focus — a focus that trails a pointer press (mouse click) is suppressed, so
//     clicking a button doesn't leave a bubble hanging. Escape dismisses it while focus stays put
//     (WCAG 1.4.13).

const OPEN_DELAY_MS = 180 // hover dwell before the bubble appears — snappy, not the native ~1s
const GAP = 6 // px between the trigger and the bubble
const EDGE = 8 // px minimum margin from the viewport edge

interface Coords {
  top: number
  left: number
}

export interface TooltipProps {
  /** The bubble text. */
  label: ReactNode
  /** The single trigger element (a button, chip, …). Cloned — no extra DOM is added. */
  children: ReactElement
  /** Hover dwell before showing, in ms. Defaults to {@link OPEN_DELAY_MS}. */
  delay?: number
}

export function Tooltip({ label, children, delay = OPEN_DELAY_MS }: TooltipProps) {
  const id = useId()
  const triggerRef = useRef<HTMLElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  // True while a focus was just initiated by a pointer press (mouse/touch click), so the focus
  // handler can distinguish it from a keyboard Tab and skip showing (hover already covers mouse).
  const pointerFocus = useRef(false)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<Coords | null>(null)

  const child = Children.only(children)

  // Stable ref callback (so React doesn't detach/reattach every render). Tooltip claims the child's
  // ref — see the header note.
  const setTriggerRef = useCallback((node: HTMLElement | null) => {
    triggerRef.current = node
  }, [])

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const hide = useCallback(() => {
    clearTimer()
    setOpen(false)
    setCoords(null)
  }, [clearTimer])

  const showAfterDelay = useCallback(() => {
    clearTimer()
    timer.current = window.setTimeout(() => setOpen(true), delay)
  }, [clearTimer, delay])

  const showNow = useCallback(() => {
    clearTimer()
    setOpen(true)
  }, [clearTimer])

  // Measure the trigger + bubble and place the bubble once it is in the DOM. Runs synchronously
  // before paint (useLayoutEffect), so the reposition from the initial {0,0} render is invisible.
  // Keyed on [open, label] only — updating `coords` here does not retrigger it, so there is no loop.
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const bubble = bubbleRef.current
    if (!trigger || !bubble) return

    const t = trigger.getBoundingClientRect()
    const b = bubble.getBoundingClientRect()

    // Above the trigger by default; flip below if that would clip the top of the viewport.
    let top = t.top - b.height - GAP
    if (top < EDGE) top = t.bottom + GAP
    // Centered on the trigger, then clamped so it never runs off a screen edge.
    let left = t.left + t.width / 2 - b.width / 2
    left = Math.max(EDGE, Math.min(left, window.innerWidth - b.width - EDGE))

    setCoords({ top, left })
  }, [open, label])

  // While open, dismiss on any scroll (the trigger has moved — a stale bubble is worse than none)
  // or resize. Capture phase so it catches scrolls inside the cluster popup / Done modal too.
  useLayoutEffect(() => {
    if (!open) return
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, hide])

  // Clean up a pending timer if the trigger unmounts mid-hover.
  useLayoutEffect(() => clearTimer, [clearTimer])

  // `react-hooks/refs` flags handing a ref callback to `cloneElement` (it can't see that this is
  // the standard Slot / `asChild` pattern). It is safe: `setTriggerRef` is a stable ref callback
  // React invokes at COMMIT to store the node — nothing reads `triggerRef.current` during render.
  // eslint-disable-next-line react-hooks/refs
  const trigger = cloneElement(child, {
    ref: setTriggerRef,
    'aria-describedby': open
      ? [child.props['aria-describedby'], id].filter(Boolean).join(' ')
      : child.props['aria-describedby'],
    onPointerEnter: (e: PointerEvent) => {
      child.props.onPointerEnter?.(e)
      showAfterDelay()
    },
    onPointerLeave: (e: PointerEvent) => {
      child.props.onPointerLeave?.(e)
      hide()
    },
    onPointerDown: (e: PointerEvent) => {
      child.props.onPointerDown?.(e)
      // A pointer press focuses the button; flag it so the imminent focus is treated as a click,
      // not a keyboard Tab. Cleared in onFocus (or shortly after, if focus never lands).
      pointerFocus.current = true
      window.setTimeout(() => {
        pointerFocus.current = false
      }, 0)
    },
    onFocus: (e: FocusEvent) => {
      child.props.onFocus?.(e)
      // Show on keyboard/programmatic focus, but NOT on the focus that trails a mouse click — hover
      // already covers the mouse, and a lingering post-click bubble is exactly what we're avoiding.
      if (!pointerFocus.current) showNow()
    },
    onBlur: (e: FocusEvent) => {
      child.props.onBlur?.(e)
      hide()
    },
    onKeyDown: (e: KeyboardEvent) => {
      child.props.onKeyDown?.(e)
      if (e.key === 'Escape') hide()
    },
  })

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            style={{
              top: coords?.top ?? 0,
              left: coords?.left ?? 0,
              visibility: coords ? 'visible' : 'hidden',
            }}
            className="pointer-events-none fixed z-[200] max-w-[16rem] rounded-md bg-ink px-2 py-1 text-center font-sans text-[11px] font-medium leading-snug text-white shadow-[0_4px_14px_rgba(0,0,0,.22)]"
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  )
}
