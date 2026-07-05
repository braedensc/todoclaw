import { useEffect } from 'react'
import type { RefObject } from 'react'

// Dismiss-on-outside-pointer for popovers/menus/dropdowns. Generic on the element type so it
// works for any ref'd container (the input-widget Due/Repeat chips today; a grid-card popover
// next). Listens on `pointerdown` (covers mouse + touch + pen in one event, and fires before
// focus/click so the close beats any inner click), in the CAPTURE phase so a child that calls
// stopPropagation can't swallow the dismissal.
//
// The ref should wrap BOTH the trigger and the floating panel: a pointerdown on the trigger then
// counts as "inside", so the trigger's own onClick handles the toggle without this hook also
// firing (which would double-close). Pass `enabled=false` (e.g. while the popover is closed) to
// detach the listener entirely.
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return
    function handlePointerDown(event: PointerEvent): void {
      const el = ref.current
      if (el && !el.contains(event.target as Node)) onOutside()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [ref, onOutside, enabled])
}
