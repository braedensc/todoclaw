import { useEffect, useState } from 'react'

// Layout gate: which shell renders — mobile (MobileMatrix + bottom nav + locked viewport) or
// desktop (masthead + inline grid). Width was the whole story until the touch-grid workshop
// (decision 1, 2026-07-22, ADR 2026-07-23-phones-stay-mobile-in-landscape): a rotated phone is
// 874pt wide on an iPhone 16 Pro, which used to flip it into the desktop shell — cramped and
// jarring. PHONES NOW STAY MOBILE IN BOTH ORIENTATIONS: the second leg catches any
// coarse-pointer device whose VIEWPORT height says "landscape phone".
//
// The same gate exists in two CSS forms that must stay in lockstep with this one:
//  - src/index.css locked-shell block uses MOBILE (this exact query);
//  - tailwind.config.js `wide` screen uses the exact COMPLEMENT (see the comment there).
// We watch a matchMedia query rather than a resize listener so we only re-render on threshold
// crossings, not on every pixel of resize.
export const MOBILE_MAX_WIDTH = 719

/**
 * The landscape leg: aspect + width, deliberately NOT viewport height. Two review/sim-caught
 * traps shaped it (2026-07-23 workshop review):
 *  - Height ceilings measure the VIEWPORT, and the iOS software keyboard SHRINKS the layout
 *    viewport in installed PWAs (932→519 measured, #328) — any max-height leg flips the whole
 *    shell mid-typing on a landscape iPad. A keyboard only makes a viewport SHORTER, which
 *    raises aspect — so the aspect test is keyboard-stable on the mobile side, and the width
 *    bound excludes iPads no matter what the keyboard does to their height.
 *  - `min-aspect-ratio: 8/5` (1.6): every landscape phone viewport is ≥ 1.78 (SE standalone,
 *    the squarest), every iPad landscape viewport is ≤ 1.53 — but an iPad TAB's chrome shrinks
 *    it into phone aspect (1210×702 ≈ 1.72, sim-measured), which is why the width bound does
 *    the iPad exclusion: landscape iPads are ≥ 1133pt wide, landscape phones ≤ 956pt.
 *    1023 splits that gap (and a deliberately phone-shaped iPad Stage-Manager window getting
 *    the phone layout is correct, not a leak). A portrait iPad's keyboard can't fake the leg
 *    either: 744×713 with the keyboard up is aspect ~1.04.
 */
export const LANDSCAPE_PHONE_MAX_WIDTH = 1023

export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px), ((pointer: coarse) and (min-aspect-ratio: 8/5) and (max-width: ${LANDSCAPE_PHONE_MAX_WIDTH}px))`

/** True when the MOBILE layout should render: narrow viewports, or landscape phones. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    // matchMedia is unavailable in some non-browser test environments; default to desktop.
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_MEDIA_QUERY).matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
    // The useState initializer already captured the current match; from here we only react to
    // the threshold being crossed (including phone rotation, which flips the second leg).
    const onChange = (e: MediaQueryListEvent): void => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
