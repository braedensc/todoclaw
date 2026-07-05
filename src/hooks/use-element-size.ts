import { useEffect, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/**
 * Track an element's rendered pixel size via `ResizeObserver`. Returns `{0, 0}` until first
 * measured — and stays `{0, 0}` in environments without `ResizeObserver` (e.g. jsdom under the
 * unit tests), where consumers fall back to a size-independent default.
 *
 * Used to size the grid's edge-clamp margins to the LIVE canvas dimensions, which change when the
 * chat push-drawer opens/closes or the window resizes (item 17). The margin is a pixel half-extent
 * over the measured dimension, so it must react to every reflow — hence an observer, not a one-time
 * measure.
 */
export function useElementSize(ref: React.RefObject<HTMLElement | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const measure = (): void => {
      const rect = el.getBoundingClientRect()
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      )
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return size
}
