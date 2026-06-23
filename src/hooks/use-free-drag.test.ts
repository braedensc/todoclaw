import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX, DEFAULT_MIN, toNormalized, type SurfaceRect } from './use-free-drag'

// A 1000×500 surface at the viewport origin makes the arithmetic easy to read:
// x = (clientX - 0) / 1000, y = 1 - (clientY - 0) / 500.
const rect: SurfaceRect = { left: 0, top: 0, width: 1000, height: 500 }

describe('toNormalized', () => {
  it('maps the centre to (0.5, 0.5)', () => {
    expect(toNormalized(rect, 500, 250)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('inverts the y-axis: a point near the TOP has a HIGH importance (y→1)', () => {
    // 25% down from the top → screen-y 125 → importance 0.75
    expect(toNormalized(rect, 500, 125)).toEqual({ x: 0.5, y: 0.75 })
    // 75% down → importance 0.25
    expect(toNormalized(rect, 500, 375)).toEqual({ x: 0.5, y: 0.25 })
  })

  it('accounts for the surface offset', () => {
    const offset: SurfaceRect = { left: 200, top: 100, width: 1000, height: 500 }
    expect(toNormalized(offset, 700, 350)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('clamps to the default [0.03, 0.97] bounds at and beyond the edges', () => {
    // top-left corner: x→0 clamps up to MIN, y→1 clamps down to MAX
    expect(toNormalized(rect, 0, 0)).toEqual({ x: DEFAULT_MIN, y: DEFAULT_MAX })
    // bottom-right corner: x→1 clamps to MAX, y→0 clamps to MIN
    expect(toNormalized(rect, 1000, 500)).toEqual({ x: DEFAULT_MAX, y: DEFAULT_MIN })
    // well outside the surface still clamps into range
    expect(toNormalized(rect, -400, 1200)).toEqual({ x: DEFAULT_MIN, y: DEFAULT_MIN })
    expect(toNormalized(rect, 4000, -800)).toEqual({ x: DEFAULT_MAX, y: DEFAULT_MAX })
  })

  it('honours custom clamp bounds', () => {
    expect(toNormalized(rect, 0, 0, 0, 1)).toEqual({ x: 0, y: 1 })
  })
})
