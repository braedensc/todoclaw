import { useEffect } from 'react'

// Ref-count the lock at module level: several sheets can be up at once (e.g. the chat sheet plus
// a confirm dialog), and the body must stay locked until the LAST one releases — a plain
// save/restore per component would unlock early when they close out of order.
let lockCount = 0
let previousOverflow = ''

/**
 * Lock body scrolling while `active` — the page behind a modal sheet must never scroll; scrolling
 * happens INSIDE the sheet (pair the sheet's scroll container with `overscroll-contain` so a
 * flick past its edge doesn't chain to the page). Restores the body's original overflow when the
 * last active lock releases.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    lockCount++
    return () => {
      lockCount--
      if (lockCount === 0) document.body.style.overflow = previousOverflow
    }
  }, [active])
}
