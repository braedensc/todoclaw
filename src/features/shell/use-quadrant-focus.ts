import { useCallback, useEffect, useState } from 'react'
import type { QuadrantKey } from '../../lib/quadrants'

// App-level state for the mobile matrix's overview → focus navigation (mobile audit §4.5): which
// quadrant the phone user is "inside", or null for the 2×2 overview.
//
// Lifted out of MobileMatrix for two reasons:
//  1. HISTORY. Entering a focus list pushes one history entry (state-flagged, no hash change), so
//     hardware/browser Back and the iOS edge-swipe return to the overview — matching Done /
//     reminders, which are real routes. Before this, Back from a focus list left the app surface
//     entirely. Switching quadrants inside focus reuses the same entry (no stack of four), and the
//     in-app ‹ button exits via history.back() so the entry is consumed, never left stale.
//  2. The add sheet (MobileAddSheet) pre-selects the focused quadrant — "add while looking at
//     Do Now" shouldn't make you re-pick Do Now — which needs the focus visible at the App level.
//
// The popstate listener distinguishes "popped back TO the focus entry" (e.state carries our flag —
// e.g. returning from #/done, keep the focus list) from "popped the focus entry itself" (state has
// no flag — clear to overview). Desktop never calls `enter`, so the hook is inert there.

const FOCUS_FLAG = 'tcQuadrantFocus'

export interface QuadrantFocus {
  /** The focused quadrant, or null when the overview is showing. */
  focus: QuadrantKey | null
  /** Enter a focus list from the overview (pushes the Back-to-overview history entry). */
  enter: (key: QuadrantKey) => void
  /** Switch quadrants while already focused (the pager) — reuses the existing history entry. */
  switchTo: (key: QuadrantKey) => void
  /** Leave via the in-app ‹ button — consumes the history entry (popstate clears the state). */
  exit: () => void
  /**
   * Drop the focus WITHOUT touching history — for flows that navigate somewhere else anyway
   * (the Home tab while on another route). May leave the flagged entry behind it in the stack;
   * popping that later is a visual no-op, which is the acceptable SPA-history wart here.
   */
  clear: () => void
}

export function useQuadrantFocus(): QuadrantFocus {
  const [focus, setFocus] = useState<QuadrantKey | null>(null)

  // Push-vs-reuse reads the CURRENT focus, so `enter` closes over it (recreated per change —
  // cheap). Deliberately not a setState-updater side effect: StrictMode double-invokes updaters,
  // which would push two entries.
  const enter = useCallback(
    (key: QuadrantKey) => {
      if (focus === null) {
        window.history.pushState({ [FOCUS_FLAG]: true }, '')
      }
      setFocus(key)
    },
    [focus],
  )

  const switchTo = useCallback((key: QuadrantKey) => setFocus(key), [])

  const exit = useCallback(() => {
    // Popping our entry fires popstate with the PRE-focus entry's state (no flag) → the listener
    // clears focus. Routing through history keeps Back and ‹ perfectly interchangeable.
    window.history.back()
  }, [])

  const clear = useCallback(() => setFocus(null), [])

  useEffect(() => {
    if (focus === null) return
    const onPop = (e: PopStateEvent) => {
      // Landed back ON the focus entry (e.g. Back out of #/done over a focus list) → keep it.
      const state = e.state as Record<string, unknown> | null
      if (state?.[FOCUS_FLAG]) return
      // Browsers fire popstate for FORWARD same-document navigations too — tapping Done pushes
      // `#/done` and Chrome/WebKit deliver a null-state popstate for it. Leaving home for a route
      // must not clear the focus (it should still be there on the way back); only a pop that
      // actually lands on the home entry (home hash, no flag) means the focus entry was popped.
      const hash = window.location.hash
      const onHomeEntry = hash === '' || hash === '#' || hash === '#/'
      if (!onHomeEntry) return
      setFocus(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [focus])

  return { focus, enter, switchTo, exit, clear }
}
