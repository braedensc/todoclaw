import { useEffect } from 'react'

/** Marks a surface inert enough that pressing it dismisses an open non-modal panel. */
export const BACKGROUND_DISMISS_ATTR = 'data-background-dismiss'

// Dismiss-on-background-press for a NON-MODAL panel (the desktop chat rail). `useClickOutside` is
// the wrong tool there: it dismisses on ANY outside pointer, which for a panel the app stays fully
// usable behind would close the drawer the moment you added a task or opened settings. A non-modal
// panel's "outside" is the working app, so a press out there is usually someone doing something
// else — not asking to close.
//
// So this fires only for a press landing on an INERT background surface, one that opts in with
// `data-background-dismiss` (see BACKGROUND_DISMISS_ATTR). The match is on the pressed element
// EXACTLY — it never walks ancestors. That distinction is what makes the rule work: pressing empty
// grid canvas targets the canvas itself (its tints, labels, and paw trail are all
// pointer-events-none), so it dismisses; pressing a card, chip, or menu that merely SITS on that
// canvas targets the card, so it doesn't, and the drag or click proceeds with the panel left open.
//
// An allowlist also fails safe. Any control added anywhere in the app is unmarked by default, so
// the worst a gap can do is leave the panel open — a denylist of "interactive" selectors would
// instead have to be taught about every new draggable div, and would start closing the panel
// mid-action the day someone forgot. Marked surfaces are few and named; see BACKGROUND_DISMISS_ATTR
// usages.
export function useBackgroundDismiss(onDismiss: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    function handlePointerDown(event: PointerEvent): void {
      // Primary button only: a right-click opens a context menu, and yanking the panel shut from
      // under it would be a surprise.
      if (event.button !== 0) return
      const target = event.target
      if (target instanceof Element && target.hasAttribute(BACKGROUND_DISMISS_ATTR)) onDismiss()
    }
    // Capture phase, matching useClickOutside: a child calling stopPropagation shouldn't be able to
    // swallow the dismissal.
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [onDismiss, enabled])
}
