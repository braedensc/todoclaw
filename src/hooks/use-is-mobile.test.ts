import { describe, expect, it, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MOBILE_MEDIA_QUERY, useIsMobile } from './use-is-mobile'

// jsdom has no matchMedia; a controllable stub lets the hook run for real. The QUERY STRING
// itself is contract: it must stay in lockstep with the index.css locked-shell block and the
// complement in tailwind.config.js's `wide` screen (ADR 2026-07-23-phones-stay-mobile-in-
// landscape), so the first test pins it verbatim.

type Listener = (e: { matches: boolean }) => void

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>()
  let queried: string | null = null
  const mql = {
    get matches() {
      return current
    },
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  }
  let current = initial
  vi.stubGlobal('matchMedia', (q: string) => {
    queried = q
    return mql
  })
  return {
    queriedQuery: () => queried,
    flip: (matches: boolean) => {
      current = matches
      listeners.forEach((fn) => fn({ matches }))
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useIsMobile', () => {
  it('pins the compound gate: narrow viewports OR coarse-pointer landscape-phone-shaped ones', () => {
    // Aspect + width, never HEIGHT: the iOS keyboard shrinks the layout viewport in installed
    // PWAs, so a height leg flips the whole shell mid-typing on a landscape iPad (review-caught;
    // see LANDSCAPE_PHONE_MAX_WIDTH's doc comment for the full derivation).
    expect(MOBILE_MEDIA_QUERY).toBe(
      '(max-width: 719px), ((pointer: coarse) and (min-aspect-ratio: 8/5) and (max-width: 1023px))',
    )
  })

  // The gate's OTHER homes (index.css locked shell, tailwind `wide`, the vp-probe badge) are
  // lockstep-pinned against this same string by scripts/check-layout-gate.test.mjs — the
  // Node-side lane, since this jsdom project is browser-typed (no node:fs).

  it('asks matchMedia for exactly the exported query and reports its match', () => {
    const media = stubMatchMedia(true)
    const { result } = renderHook(() => useIsMobile())
    expect(media.queriedQuery()).toBe(MOBILE_MEDIA_QUERY)
    expect(result.current).toBe(true)
  })

  it('re-renders when the gate flips — e.g. a phone rotating', () => {
    const media = stubMatchMedia(false)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
    act(() => media.flip(true))
    expect(result.current).toBe(true)
    act(() => media.flip(false))
    expect(result.current).toBe(false)
  })
})
