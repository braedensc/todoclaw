import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppHeight } from './use-app-height'

// jsdom has no visualViewport — install the same controllable fake as use-keyboard-viewport.test.ts
// and drive its resize events. The numbers mirror the iOS 26.5 iPhone-15-Pro-Max measurements the
// hook exists for: standalone launches at 873 (screen minus top inset), settles to 932 (full
// bleed), and the keyboard shrinks the viewport to 519.
let listeners: Set<() => void>
let vv: { height: number }

function setViewport(height: number): void {
  vv.height = height
  act(() => listeners.forEach((cb) => cb()))
}

function appH(): string {
  return document.documentElement.style.getPropertyValue('--app-h')
}

beforeEach(() => {
  listeners = new Set()
  vv = { height: 873 }
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      get height() {
        return vv.height
      },
      addEventListener: (_t: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_t: string, cb: () => void) => listeners.delete(cb),
    },
  })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 430 })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport')
  document.documentElement.style.removeProperty('--app-h')
})

describe('useAppHeight', () => {
  it('pins --app-h to the measured viewport on mount', () => {
    renderHook(() => useAppHeight(true))
    expect(appH()).toBe('873px')
  })

  it('follows the standalone 873→932 settle (growth is always real)', () => {
    renderHook(() => useAppHeight(true))
    setViewport(932)
    expect(appH()).toBe('932px')
  })

  it('ignores a keyboard-sized shrink — the shell must stay put behind the keys', () => {
    renderHook(() => useAppHeight(true))
    setViewport(932)
    setViewport(519) // keyboard: 413px shrink, way past the 80px floor
    expect(appH()).toBe('932px')
    setViewport(932) // keyboard dismissed
    expect(appH()).toBe('932px')
  })

  it('adopts a small chrome-sized shrink (the 932→873 web-app state flip)', () => {
    renderHook(() => useAppHeight(true))
    setViewport(932)
    setViewport(873) // 59px: web-app chrome, not a keyboard — the shell must follow or the
    expect(appH()).toBe('873px') // bottom nav hangs below the physical screen again
  })

  it('re-baselines on a width change (rotation), even to a smaller height', () => {
    renderHook(() => useAppHeight(true))
    setViewport(932)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 932 })
    setViewport(430) // landscape: far shorter than 932, but the width changed so it is real
    expect(appH()).toBe('430px')
  })

  it('falls back to innerHeight where visualViewport is unsupported', () => {
    Reflect.deleteProperty(window, 'visualViewport')
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })
    renderHook(() => useAppHeight(true))
    expect(appH()).toBe('700px')
  })

  it('does nothing while disabled, and removes the var on unmount', () => {
    const { unmount, rerender } = renderHook(({ on }) => useAppHeight(on), {
      initialProps: { on: false },
    })
    expect(appH()).toBe('')
    expect(listeners.size).toBe(0)
    rerender({ on: true })
    expect(appH()).toBe('873px')
    unmount()
    expect(appH()).toBe('')
    expect(document.querySelector('[data-app-h-probe]')).toBeNull()
  })

  // ——— the iOS-standalone top-anchored cold-launch state (iPhone 16: viewport 793 pinned to the
  // top of a full-bleed 852 window; env-top 59 reaches the page). The shell must span the WINDOW
  // (100lvh), not the short viewport, or the nav floats 59px above the physical bottom. jsdom has
  // no layout, so the probe the hook plants is stubbed per-test: rect.height ⇒ 100lvh, computed
  // paddingTop ⇒ env(safe-area-inset-top).
  const realGetComputedStyle = window.getComputedStyle

  function stubStandaloneProbe(envTopPx: number, windowHPx: number): void {
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true })
    const probe = document.querySelector('[data-app-h-probe]') as HTMLElement
    probe.getBoundingClientRect = () =>
      ({ height: windowHPx, width: 0, top: 0, left: -9999, bottom: 0, right: 0 }) as DOMRect
    const realGCS = realGetComputedStyle.bind(window)
    window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
      const style = realGCS(el, pseudo)
      if (el === probe) {
        return new Proxy(style, {
          get: (t, p) => (p === 'paddingTop' ? `${envTopPx}px` : Reflect.get(t, p)),
        })
      }
      return style
    }) as typeof window.getComputedStyle
  }

  afterEach(() => {
    Reflect.deleteProperty(window.navigator, 'standalone')
    Reflect.deleteProperty(document, 'visibilityState')
    window.getComputedStyle = realGetComputedStyle
  })

  describe('top-anchored standalone launch state', () => {
    it('raises the shell to the window height when env-top > 0 (iPhone 16 cold launch)', () => {
      vv.height = 793
      renderHook(() => useAppHeight(true))
      stubStandaloneProbe(59, 852)
      setViewport(793) // re-apply with the probe active: same vv, but env-top says top-anchored
      expect(appH()).toBe('852px')
    })

    it('keeps the raised shell through a standalone keyboard shrink', () => {
      vv.height = 793
      renderHook(() => useAppHeight(true))
      stubStandaloneProbe(59, 852)
      setViewport(793)
      setViewport(452) // standalone keyboard: shrinks vv way past the 80px floor
      expect(appH()).toBe('852px')
    })

    it('is a no-op when env-top is 0 (bottom-anchored short state / browser tab)', () => {
      vv.height = 873
      renderHook(() => useAppHeight(true))
      stubStandaloneProbe(0, 932)
      setViewport(873)
      expect(appH()).toBe('873px') // vv path: lvh(932) must NOT win or the nav overhangs
    })

    it('is a no-op outside iOS standalone even with env-top set (in-app webviews)', () => {
      vv.height = 793
      renderHook(() => useAppHeight(true))
      stubStandaloneProbe(59, 852)
      Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: false })
      setViewport(793)
      expect(appH()).toBe('793px')
    })

    it('matches exactly at the settled geometry (no oversize once vv == window)', () => {
      vv.height = 793
      renderHook(() => useAppHeight(true))
      stubStandaloneProbe(59, 852)
      setViewport(852) // settled: viewport grew to full bleed
      expect(appH()).toBe('852px')
    })
  })

  describe('resume re-measure', () => {
    it('rebuilds the baseline on pageshow (restored document, missed resize events)', () => {
      renderHook(() => useAppHeight(true))
      setViewport(932)
      expect(appH()).toBe('932px')
      // Suspended mid-keyboard at 519, restored into a 793 tab geometry with no resize event:
      // a plain apply() would hold 932 (shrink > 80px floor); pageshow must re-baseline.
      vv.height = 793
      act(() => {
        window.dispatchEvent(new Event('pageshow'))
      })
      expect(appH()).toBe('793px')
    })

    it('re-measures when the document becomes visible again', () => {
      renderHook(() => useAppHeight(true))
      setViewport(932)
      vv.height = 793
      act(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'visible',
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(appH()).toBe('793px')
      Reflect.deleteProperty(document, 'visibilityState')
    })

    it('ignores resize events that fire while the document is hidden', () => {
      renderHook(() => useAppHeight(true))
      setViewport(932)
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      })
      setViewport(873) // backgrounding fires an intermediate size — must not be adopted
      expect(appH()).toBe('932px')
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      })
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(appH()).toBe('873px') // …and the visible re-measure adopts the real current size
      Reflect.deleteProperty(document, 'visibilityState')
    })
  })
})
