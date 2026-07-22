import { useEffect } from 'react'
import { KEYBOARD_MIN_PX } from './use-keyboard-viewport'

// Pin the mobile shell to the MEASURED viewport height (`--app-h` on <html>), because in an
// installed iOS web app no CSS viewport unit tells the truth (measured on iOS 26.5, iPhone 15
// Pro Max sim, fix/chat-keyboard-bottom-bar):
//
//   - The standalone viewport itself FLIPS between two geometries: 873px (screen minus the
//     59px top inset, bottom-anchored — fresh launch) and 932px (full-bleed — after the
//     web-app chrome settles). A resize event fires on the flip.
//   - `100lvh` is a static 932 → in the 873 state the shell overhangs the physical screen
//     bottom and the bottom nav is clipped to a sliver (the iPhone-15-Pro-Max "bottom bar too
//     tiny" bug; #317 shipped lvh after measuring only the full-bleed state on an iPhone 16).
//   - `100dvh` tracks 873↔932, so in the short state the nav floats 59px up (the original
//     #317 float bug) — and worse, an lvh/oversized shell leaves 59px of scrollable slack
//     that iOS pans when the chat composer focuses, displacing every fixed-position sheet.
//   - In a BROWSER tab dvh is already correct (775 on the same device) — and there
//     visualViewport.height == dvh, so this hook changes nothing.
//
// visualViewport.height is the one value that always equals the real, current viewport. The
// shell must NOT shrink for the on-screen keyboard though (the nav deliberately stays put
// behind the keys — index.html's resizes-visual contract), and in standalone the keyboard
// shrinks the layout AND visual viewports (by ~413px on the 15 Pro Max — #318's discovery).
// So: adopt growth and small chrome-sized changes, ignore keyboard-sized shrinks (same
// KEYBOARD_MIN_PX floor as use-keyboard-viewport), and re-baseline when the width changes
// (rotation / real window resize).
//
// Callers: App mounts this once for the mobile shell (alongside useLockedViewportGuard).
// src/index.css consumes the var: `height: var(--app-h, 100dvh)` — the dvh fallback covers
// first paint before this effect runs, and any environment with no visualViewport.
export function useAppHeight(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    let baseWidth = window.innerWidth
    let h = 0
    let applied = -1
    const apply = () => {
      const vv = window.visualViewport
      const visible = Math.round(vv ? vv.height : window.innerHeight)
      if (window.innerWidth !== baseWidth) {
        // Rotation / genuine resize: the old baseline is meaningless — start fresh.
        baseWidth = window.innerWidth
        h = 0
      }
      // Growth is always real (the standalone 873→932 settle, keyboard dismissal). A small
      // shrink is web-app chrome appearing (≤ the keyboard floor) — also real. A big shrink
      // is the software keyboard: NOT a shell change, ignore it.
      if (visible > h || h - visible <= KEYBOARD_MIN_PX) h = visible
      if (h !== applied) {
        applied = h
        root.style.setProperty('--app-h', `${h}px`)
      }
    }
    apply()
    const vv = window.visualViewport
    vv?.addEventListener('resize', apply)
    window.addEventListener('resize', apply)
    return () => {
      vv?.removeEventListener('resize', apply)
      window.removeEventListener('resize', apply)
      root.style.removeProperty('--app-h')
    }
  }, [enabled])
}
