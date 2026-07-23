import { useCallback, useEffect, useState } from 'react'

// App-level state for grid-only mode (the fullscreen grid takeover), history-integrated the same
// way as use-quadrant-focus: entering pushes ONE state-flagged history entry (no hash change), so
// the hardware/browser Back gesture and the in-app ✕ pill are interchangeable exits — essential
// on mobile, where the touch grid (TouchGridSurface) is a full takeover with no other chrome.
// Desktop gets the same semantics for free (Esc / ✕ route through history.back()).
//
// The popstate listener copies use-quadrant-focus's two guards verbatim:
//  - landing back ON our flagged entry (e.g. Back out of a #/chat deep link opened over the
//    grid) keeps the mode;
//  - browsers deliver popstate for FORWARD same-document navs too (a hash push arrives as a
//    null-state popstate), so only a pop that actually lands on a home-hash entry exits.

const GRID_ONLY_FLAG = 'tcGridOnly'

export interface GridOnlyMode {
  /** True while the fullscreen grid owns the screen. */
  gridOnly: boolean
  /** Enter grid-only (pushes the Back-to-normal history entry). */
  enter: () => void
  /** Leave via ✕ / Esc — consumes the history entry (the resulting popstate clears the state). */
  exit: () => void
}

export function useGridOnly(): GridOnlyMode {
  const [gridOnly, setGridOnly] = useState(false)

  // Deliberately not a setState-updater side effect: StrictMode double-invokes updaters, which
  // would push two entries (same note as use-quadrant-focus).
  const enter = useCallback(() => {
    if (!gridOnly) {
      window.history.pushState({ [GRID_ONLY_FLAG]: true }, '')
    }
    setGridOnly(true)
  }, [gridOnly])

  const exit = useCallback(() => {
    window.history.back()
  }, [])

  useEffect(() => {
    if (!gridOnly) return
    const onPop = (e: PopStateEvent) => {
      const state = e.state as Record<string, unknown> | null
      if (state?.[GRID_ONLY_FLAG]) return
      const hash = window.location.hash
      const onHomeEntry = hash === '' || hash === '#' || hash === '#/'
      if (!onHomeEntry) return
      setGridOnly(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [gridOnly])

  return { gridOnly, enter, exit }
}
