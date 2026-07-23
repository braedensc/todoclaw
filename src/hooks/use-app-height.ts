import { useEffect } from 'react'
import { KEYBOARD_MIN_PX } from './use-keyboard-viewport'

// Pin the mobile shell to the MEASURED viewport height (`--app-h` on <html>), because in an
// installed iOS web app no CSS viewport unit tells the truth. Measured on the iOS 26.5 sims
// (iPhone 16 + 15 Pro Max, fresh web-clip installs, fix/iphone16-bottom-bar-still-high):
//
//   - COLD LAUNCH: the window is full-bleed (== screen), but the layout+visual viewport is
//     screen minus the top inset (793 on the 16, 873 on the 15 Pro Max) and sits at the TOP of
//     the window — a dead, unpainted strip spans the bottom 59px. env(safe-area-inset-top)
//     reaches the page (59), proving the viewport overlaps the status bar. This state persists
//     indefinitely — it "settles" to full-bleed only after the first DOM-mutating tap, never on
//     its own. A shell sized to visualViewport.height therefore floats the bottom nav 59px up
//     at every cold open (#328 shipped exactly that; this file is the fix). Document overflow
//     BELOW the short viewport still paints down to the window bottom (verified: #317's lvh
//     shell was visually flush in this same state), so the shell must span the WINDOW height —
//     which is what 100lvh measures.
//   - SETTLED (after first interactive tap): viewport == window == screen; everything agrees.
//     Background/resume keeps the settled geometry.
//   - KEYBOARD (standalone): innerHeight AND visualViewport.height shrink together (~341-413px);
//     the shell must NOT follow (the nav deliberately stays put behind the keys — index.html's
//     resizes-visual contract).
//   - HISTORIC (#328's session, not reproducible on fresh installs today): a short viewport
//     anchored at the window BOTTOM, where an lvh-sized shell overhangs the physical screen
//     (#317's "bottom bar too tiny"). There the page does NOT overlap the status bar, so
//     env(safe-area-inset-top) is 0 (env() is viewport-relative: Safari tabs read 0 while the
//     screen inset is 59) and the vv path below handles it. If that state ever reappears WITH
//     env-top > 0, this hook would regress it to #317's overhang — accepted: the alternative is
//     a persistent float at every cold open on every device.
//   - In a BROWSER tab dvh == visualViewport.height and env-top == 0 — the lvh branch never
//     engages, so tab behavior is unchanged from #328.
//
// The rule: shell = filtered visualViewport.height, raised to the measured 100lvh window height
// when (iOS standalone && env-top > 0) says the viewport is pinned to the window top. The
// keyboard filter stays: adopt growth and small chrome-sized changes, ignore keyboard-sized
// shrinks (same KEYBOARD_MIN_PX floor as use-keyboard-viewport), re-baseline when the width
// changes (rotation / real window resize).
//
// iOS also freezes suspended pages and restores serialized documents without replaying missed
// resize events, so a resumed document re-measures on pageshow / visibilitychange→visible with
// a fresh baseline; events that fire while hidden are ignored (backgrounding fires bogus
// intermediate sizes).
//
// Callers: App mounts this once for the mobile shell (alongside useLockedViewportGuard).
// src/index.css consumes the var: `height: var(--app-h, 100dvh)` — the dvh fallback covers
// first paint before this effect runs, and any environment with no visualViewport.
// public/vp-probe.js's [app] mode mirrors this algorithm verbatim — keep them in sync.
export function useAppHeight(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    // Hidden probe measuring the two values CSS knows but JS has no API for: the large-viewport
    // (window) height and the resolved top safe-area inset. border-box keeps rect.height ==
    // 100lvh regardless of the padding; the vh declaration is the fallback where lvh is
    // unsupported. jsdom drops env()/lvh and returns a 0-height rect → both read 0 → the lvh
    // branch is inert in tests unless they stub the probe.
    const probe = document.createElement('div')
    probe.setAttribute('data-app-h-probe', '')
    probe.style.cssText =
      'position:fixed;top:0;left:-9999px;width:0;box-sizing:border-box;' +
      'height:100vh;height:100lvh;padding-top:env(safe-area-inset-top,0px);' +
      'visibility:hidden;pointer-events:none;'
    document.body.appendChild(probe)
    let baseWidth = window.innerWidth
    let h = 0
    let applied = -1
    const apply = () => {
      if (document.visibilityState === 'hidden') return
      const vv = window.visualViewport
      const visible = Math.round(vv ? vv.height : window.innerHeight)
      if (window.innerWidth !== baseWidth) {
        // Rotation / genuine resize: the old baseline is meaningless — start fresh.
        baseWidth = window.innerWidth
        h = 0
      }
      // Growth is always real (the standalone settle, keyboard dismissal). A small shrink is
      // web-app chrome appearing (≤ the keyboard floor) — also real. A big shrink is the
      // software keyboard: NOT a shell change, ignore it.
      if (visible > h || h - visible <= KEYBOARD_MIN_PX) h = visible
      // Top-anchored standalone launch state: the viewport starts at the window top (env-top
      // reaches the page) but ends short of the window bottom — the shell must reach the
      // window bottom, i.e. the measured 100lvh.
      let shell = h
      if ((window.navigator as { standalone?: boolean }).standalone === true) {
        const envTop = parseFloat(getComputedStyle(probe).paddingTop) || 0
        const windowH = Math.round(probe.getBoundingClientRect().height)
        if (envTop > 0 && windowH > shell) shell = windowH
      }
      if (shell !== applied) {
        applied = shell
        root.style.setProperty('--app-h', `${shell}px`)
      }
    }
    const remeasure = () => {
      // Resume from suspension / serialized-document restore: missed resize events mean the
      // ratchet may hold a stale state — rebuild it from scratch (no keyboard can be up across
      // a resume, so trusting the current reading is safe).
      h = 0
      apply()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') remeasure()
    }
    apply()
    const vv = window.visualViewport
    vv?.addEventListener('resize', apply)
    window.addEventListener('resize', apply)
    window.addEventListener('pageshow', remeasure)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      vv?.removeEventListener('resize', apply)
      window.removeEventListener('resize', apply)
      window.removeEventListener('pageshow', remeasure)
      document.removeEventListener('visibilitychange', onVisibility)
      probe.remove()
      root.style.removeProperty('--app-h')
    }
  }, [enabled])
}
