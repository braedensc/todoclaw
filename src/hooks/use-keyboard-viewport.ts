import { useEffect, useState } from 'react'

// Below this many px of overlap we treat the change as viewport noise (URL-bar collapse, a thin
// accessory strip, sub-pixel rounding) rather than a real software keyboard. Every real on-screen
// keyboard — even a landscape one with the predictive bar — is far taller than this, so the sheet
// only re-anchors for an actual keyboard and not for incidental visual-viewport jitter.
// Exported: use-locked-viewport-guard.ts shares the same "is a keyboard up" floor.
export const KEYBOARD_MIN_PX = 80

export interface KeyboardViewport {
  /** Height (px) of the software keyboard overlapping the layout viewport; 0 when closed. */
  inset: number
  /** Visible height (px) left above the keyboard (visualViewport.height); 0 where unsupported. */
  height: number
  /**
   * Top edge (px) of the visible band within the layout viewport (visualViewport.offsetTop).
   * The robust anchor for a `fixed` sheet: `top: top; height: height` lands on the visible
   * band using ONLY visualViewport values. Mathematically `top ≡ innerHeight − height − inset`
   * (the old bottom-anchoring), but without referencing innerHeight — which an installed-PWA
   * keyboard SHRINKS (932→519 measured on the 15 Pro Max sim) and iOS focus-scroll pans, so any
   * innerHeight sampled a beat earlier positions the sheet somewhere that no longer exists.
   */
  top: number
  /** True while a real keyboard is overlapping — the cue to re-fit the sheet to the visible area. */
  keyboardOpen: boolean
}

const CLOSED: KeyboardViewport = { inset: 0, height: 0, top: 0, keyboardOpen: false }

// Track the visual viewport so a bottom-anchored mobile sheet can re-fit itself to the area the
// keyboard leaves visible.
//
// Why (mobile audit §3.3): in a Safari TAB iOS does NOT shrink the layout viewport — or anything
// sized in dvh — when the keyboard opens; it overlays. A sheet sized to the layout viewport keeps
// its full dvh height, so its top runs off the top of the screen and its composer hides behind the
// keys. The visual viewport IS shrunk to the visible area, and the keyboard always occupies the
// bottom `inset` px of the layout viewport — so a `position: fixed` sheet can pin its bottom there
// (`bottom: inset`) and take `height`, landing it exactly over the visible region no matter how far
// iOS has auto-scrolled the page (offsetTop is already folded into `inset`, so a bottom-anchored
// element needs no separate scroll compensation).
//
// The INSTALLED PWA (display-mode: standalone, added to Home Screen) is the exception that broke for
// a reporter (#317-followup): there iOS shrinks the LAYOUT viewport too — window.innerHeight itself
// drops to the visible band when the keyboard opens. So `innerHeight - vv.height` collapses toward 0
// and a keyboard is never detected. We fix this WITHOUT branching on mode (per WebKit guidance, key
// off actual viewport change, not display-mode): detection measures the visible height against a
// captured baseline of the keyboard-DOWN layout height. In a tab that baseline always equals live
// innerHeight, so the math reduces to the old `innerHeight - vv.height` — the working path is
// byte-for-byte unchanged; the baseline only diverges once innerHeight actually shrinks (standalone).
//
// `enabled` scopes the listeners to while the sheet is open; returns CLOSED where visualViewport is
// unsupported (callers keep their static layout).
export function useKeyboardViewport(enabled: boolean): KeyboardViewport {
  const [vp, setVp] = useState<KeyboardViewport>(CLOSED)

  useEffect(() => {
    if (!enabled) return
    const vv = window.visualViewport
    if (!vv) return

    // The layout-viewport height with the keyboard DOWN — our reference for "how tall is the screen
    // without a keyboard". A tab never shrinks innerHeight, so this just tracks it; a standalone PWA
    // does, so we remember the pre-keyboard value. innerWidth only changes on a real rotation/resize,
    // never for a keyboard — so re-baseline when it does, and otherwise let innerHeight only ever
    // recover UP to the baseline (a shrink is the keyboard, and `Math.max` ignores it).
    let baseInnerHeight = window.innerHeight
    let baseInnerWidth = window.innerWidth

    const update = () => {
      if (window.innerWidth !== baseInnerWidth) {
        // Orientation / genuine window resize: the full height changed for real — start fresh.
        baseInnerWidth = window.innerWidth
        baseInnerHeight = window.innerHeight
      } else if (window.innerHeight > baseInnerHeight) {
        // Keyboard dismissed (or URL bar settled): innerHeight recovered to its full value.
        baseInnerHeight = window.innerHeight
      }

      // Detection: the visible viewport's shrink below the keyboard-down layout height. Scroll- AND
      // mode-independent — offsetTop only moves the visible band, never its height, and the baseline
      // survives a standalone innerHeight shrink. This — not `inset` below — is the reliable "is a
      // keyboard present" signal. (`inset` folds offsetTop in and collapses toward 0 once iOS scrolls
      // the page to reveal a focused composer near the bottom; deriving keyboardOpen from it made the
      // sheet read "keyboard closed" mid-typing — dropping the re-fit AND re-arming swipe-to-dismiss.)
      const overlap = Math.max(0, Math.round(baseInnerHeight - vv.height))
      // Positioning: the bottom offset for a `position: fixed` sheet, measured against the LIVE layout
      // viewport (not the baseline). Tab: innerHeight is still full, so this is the keyboard height
      // (minus any iOS auto-scroll, offsetTop). Standalone: innerHeight already shrank to the visible
      // band, so this is ~0 — and `fixed` is now relative to that shrunk band, so bottom:~0 + height
      // fills the space above the keys. One formula, both modes; offsetTop stays folded in for the tab
      // case (hard-won across #263/#275/#291/#292 — do not regress).
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      const height = Math.round(vv.height)
      // The visible band's top edge, straight from visualViewport — the innerHeight-free anchor
      // (see the interface note). Both chat shells position with top+height; `inset` stays for
      // callers that want the bottom-anchored form.
      const top = Math.max(0, Math.round(vv.offsetTop))
      const keyboardOpen = overlap > KEYBOARD_MIN_PX
      // Skip the state churn (and re-render) when a scroll/resize event leaves the geometry
      // unchanged — visualViewport 'scroll' can fire rapidly while a finger drags.
      setVp((prev) =>
        prev.inset === inset &&
        prev.height === height &&
        prev.top === top &&
        prev.keyboardOpen === keyboardOpen
          ? prev
          : { inset, height, top, keyboardOpen },
      )
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    // A standalone PWA fires a window 'resize' when the keyboard shrinks the layout viewport (a tab
    // does not — only visualViewport 'resize' fires there); this also catches orientation changes.
    window.addEventListener('resize', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      setVp(CLOSED)
    }
  }, [enabled])

  return vp
}
