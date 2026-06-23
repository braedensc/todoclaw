import { useEffect, useState } from 'react'

// Mobile breakpoint: < 720px (CLAUDE.md "Key Design Decisions"). Below it the grid
// swaps drag for tap-to-place. We watch a matchMedia query rather than a resize listener
// so we only re-render on the threshold crossing, not on every pixel of resize.
export const MOBILE_MAX_WIDTH = 719

const QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`

/** True when the viewport is at or below the mobile breakpoint (< 720px). */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    // matchMedia is unavailable in some non-browser test environments; default to desktop.
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(QUERY).matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    // The useState initializer already captured the current match; from here we only react to
    // the breakpoint being crossed. (A synchronous re-read here would just re-trigger render.)
    const onChange = (e: MediaQueryListEvent): void => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
