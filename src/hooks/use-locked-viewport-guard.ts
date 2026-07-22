import { useEffect } from 'react'
import { KEYBOARD_MIN_PX } from './use-keyboard-viewport'

// Guard the mobile shell's locked viewport against scroll residue.
//
// Below the breakpoint the page never scrolls by design: html/body are height:100dvh +
// overflow:hidden and the bottom nav is the flex column's last in-flow child (src/index.css), so
// the bar sits flush to the screen bottom. But iOS Safari can still pan the WINDOW despite
// overflow:hidden — focusing an input auto-scrolls the document to reveal the caret above the
// keyboard, and on some devices that offset survives the keyboard closing. The whole shell is then
// left shifted up: the bottom bar floats above the true screen bottom with a dead strip under it
// ("the bar got pulled up"), until something re-scrolls the page.
//
// The guard snaps the page back to 0 whenever it finds the window scrolled while NO keyboard is
// up. While a keyboard IS up (visual viewport shrunk past the shared KEYBOARD_MIN_PX floor) it
// deliberately does nothing — that pan is iOS revealing the focused field, and fighting it would
// hide the caret. The keyboard closing fires visualViewport 'resize', so the residue is cleared
// the moment it can safely be. A window 'scroll' listener catches any other stray pan (rubber-band
// overscroll edge cases) — on an unscrolled page it never fires, and snapping to 0 re-fires it
// exactly once as a no-op, so there is no loop.
export function useLockedViewportGuard(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    const snapBack = () => {
      const vv = window.visualViewport
      const overlap = vv ? Math.max(0, Math.round(window.innerHeight - vv.height)) : 0
      if (overlap > KEYBOARD_MIN_PX) return // keyboard up — the pan is load-bearing, leave it
      const scroller = document.scrollingElement ?? document.documentElement
      if (window.scrollY !== 0 || scroller.scrollTop !== 0) {
        window.scrollTo(0, 0)
        scroller.scrollTop = 0
      }
    }

    window.addEventListener('scroll', snapBack, { passive: true })
    window.visualViewport?.addEventListener('resize', snapBack)
    snapBack() // clear anything left over from before mount (e.g. a desktop→mobile resize)
    return () => {
      window.removeEventListener('scroll', snapBack)
      window.visualViewport?.removeEventListener('resize', snapBack)
    }
  }, [enabled])
}
