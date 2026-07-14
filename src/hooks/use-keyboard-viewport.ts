import { useEffect, useState } from 'react'

// Below this many px of overlap we treat the change as viewport noise (URL-bar collapse, a thin
// accessory strip, sub-pixel rounding) rather than a real software keyboard. Every real on-screen
// keyboard — even a landscape one with the predictive bar — is far taller than this, so the sheet
// only re-anchors for an actual keyboard and not for incidental visual-viewport jitter.
const KEYBOARD_MIN_PX = 80

export interface KeyboardViewport {
  /** Height (px) of the software keyboard overlapping the layout viewport; 0 when closed. */
  inset: number
  /** Visible height (px) left above the keyboard (visualViewport.height); 0 where unsupported. */
  height: number
  /** True while a real keyboard is overlapping — the cue to re-fit the sheet to the visible area. */
  keyboardOpen: boolean
}

const CLOSED: KeyboardViewport = { inset: 0, height: 0, keyboardOpen: false }

// Track the visual viewport so a bottom-anchored mobile sheet can re-fit itself to the area the
// keyboard leaves visible.
//
// Why (mobile audit §3.3): iOS does NOT shrink the layout viewport — or anything sized in dvh —
// when the keyboard opens; it overlays. A sheet sized to the layout viewport keeps its full dvh
// height, so its top runs off the top of the screen and its composer hides behind the keys. The
// visual viewport IS shrunk to the visible area, and the keyboard always occupies the bottom
// `inset` px of the layout viewport — so a `position: fixed` sheet can pin its bottom there
// (`bottom: inset`) and take `height`, landing it exactly over the visible region no matter how far
// iOS has auto-scrolled the page (offsetTop is already folded into `inset`, so a bottom-anchored
// element needs no separate scroll compensation). `enabled` scopes the listeners to while the sheet
// is open; returns CLOSED where visualViewport is unsupported (callers keep their static layout).
export function useKeyboardViewport(enabled: boolean): KeyboardViewport {
  const [vp, setVp] = useState<KeyboardViewport>(CLOSED)

  useEffect(() => {
    if (!enabled) return
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      const height = Math.round(vv.height)
      const keyboardOpen = inset > KEYBOARD_MIN_PX
      // Skip the state churn (and re-render) when a scroll/resize event leaves the geometry
      // unchanged — visualViewport 'scroll' can fire rapidly while a finger drags.
      setVp((prev) =>
        prev.inset === inset && prev.height === height && prev.keyboardOpen === keyboardOpen
          ? prev
          : { inset, height, keyboardOpen },
      )
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setVp(CLOSED)
    }
  }, [enabled])

  return vp
}
