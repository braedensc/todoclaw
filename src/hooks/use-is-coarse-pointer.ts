import { useEffect, useState } from 'react'

// Capability check: is the PRIMARY pointer a touch digit? Mirrors useIsMobile's matchMedia
// shape, but answers a different question (ADR 2026-07-22-capability-keyed-insets-width-keyed-
// shell): the layout gate decides which LAYOUT renders; pointer coarseness decides which
// INTERACTION SURFACE a shared mode gets — an iPad is desktop-layout but touch-first, so
// grid-only mode gives it the touch grid instead of the pointer overlay. (Landscape iPhones
// reach the touch grid via the layout gate's mobile side — ADR 2026-07-23 — not this hook.)
// Note `pointer`, not `any-pointer`: a touch-screen laptop with a mouse stays fine-pointer.
const QUERY = '(pointer: coarse)'

/** True when the device's primary pointer is coarse (finger) — phones and tablets. */
export function useIsCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState<boolean>(() =>
    // matchMedia is unavailable in non-browser test environments; default to fine pointer.
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(QUERY).matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    const onChange = (e: MediaQueryListEvent): void => setCoarse(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return coarse
}
