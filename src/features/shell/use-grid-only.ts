import { useCallback, useEffect, useRef, useState } from 'react'

// App-level state for grid-only mode (the fullscreen grid takeover), history-integrated the same
// way as use-quadrant-focus: entering pushes ONE state-flagged history entry (no hash change), so
// the hardware/browser Back gesture and the in-app ✕ pill are interchangeable exits — essential
// on mobile, where the touch grid (TouchGridSurface) is a full takeover with no other chrome.
// Desktop gets the same semantics for free (Esc / ✕ route through history.back()).
//
// The popstate listener follows use-quadrant-focus's guards, with one difference: unlike quadrant
// focus (enterable only from home), grid-only can be entered while a #/chat deep link is the
// current entry (the desktop header pill renders on the chat route too). So instead of a
// hard-coded home-hash check, `enter()` RECORDS the hash it was entered on, and a pop only exits
// the mode when it lands on that recorded hash — a pop landing anywhere else, and any FORWARD
// same-document nav (browsers deliver those as null-state popstates too), keeps it. Known wart,
// same family as quadrant focus's: closing a chat that grid-only was entered FROM pops our entry
// and lands on the entry hash, exiting the grid back to the chat — coherent, if unusual.
//
// The flag is exported so use-quadrant-focus can recognize a pop landing on OUR entry (a focus
// entry can sit beneath a grid-only entry; without this, that pop would wrongly clear the focus).

export const GRID_ONLY_FLAG = 'tcGridOnly'

export interface GridOnlyMode {
  /** True while the fullscreen grid owns the screen. */
  gridOnly: boolean
  /** Enter grid-only (pushes the Back-to-normal history entry). */
  enter: () => void
  /** Leave via ✕ / Esc — consumes the history entry (the resulting popstate clears the state). */
  exit: () => void
}

// The home hash has three spellings; treat them as one entry identity so entering from '' and
// popping back to '#/' (or vice versa) still reads as "landed on the entry we came from".
const normalizeHash = (hash: string): string => (hash === '' || hash === '#' ? '#/' : hash)

export function useGridOnly(): GridOnlyMode {
  const [gridOnly, setGridOnly] = useState(false)
  // The hash of the entry grid-only was entered ON — the pop destination that means "our flagged
  // entry was just consumed". A ref (not state): only the popstate listener reads it.
  const entryHashRef = useRef('#/')

  // Deliberately not a setState-updater side effect: StrictMode double-invokes updaters, which
  // would push two entries (same note as use-quadrant-focus).
  const enter = useCallback(() => {
    if (!gridOnly) {
      entryHashRef.current = normalizeHash(window.location.hash)
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
      // Landed back ON our flagged entry (e.g. Back out of a #/chat deep link opened over the
      // grid) → keep the mode.
      const state = e.state as Record<string, unknown> | null
      if (state?.[GRID_ONLY_FLAG]) return
      // Only a pop that lands on the entry we were entered FROM means our entry was consumed.
      // Forward same-document navs (hash pushes arrive as null-state popstates) and pops onto
      // other overlays' entries keep the mode.
      if (normalizeHash(window.location.hash) !== entryHashRef.current) return
      setGridOnly(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [gridOnly])

  return { gridOnly, enter, exit }
}
