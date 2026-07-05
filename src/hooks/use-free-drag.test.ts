import { describe, expect, it } from 'vitest'
import {
  boxClampBounds,
  clampPoint,
  DEFAULT_MAX,
  DEFAULT_MIN,
  toNormalized,
  type SurfaceRect,
} from './use-free-drag'

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

  it('honours custom per-axis clamp bounds', () => {
    expect(toNormalized(rect, 0, 0, { minX: 0, maxX: 1, minY: 0, maxY: 1 })).toEqual({ x: 0, y: 1 })
  })
})

describe('boxClampBounds', () => {
  it('makes the margin a half-extent over the dimension (a card near the edge pulls inward)', () => {
    // A 112px card (56px half-width) on a 1000px-wide, 640px-tall grid → 5.6% x-margin, ~6.9% y.
    const bounds = boxClampBounds({ width: 1000, height: 640 }, 56, 44)
    expect(bounds.minX).toBeCloseTo(0.056)
    expect(bounds.maxX).toBeCloseTo(0.944)
    expect(bounds.minY).toBeCloseTo(0.06875)
    expect(bounds.maxY).toBeCloseTo(0.93125)
  })

  it('scales the margin with the grid: a narrower grid needs a wider proportional margin', () => {
    const wide = boxClampBounds({ width: 1000, height: 640 }, 56, 44)
    const narrow = boxClampBounds({ width: 500, height: 320 }, 56, 44)
    // Halving the width doubles the fractional x-margin (same 56px over half the pixels).
    expect(narrow.minX).toBeCloseTo(wide.minX * 2)
  })

  it('falls back to the flat 3% default when the surface is unmeasured (0px)', () => {
    expect(boxClampBounds({ width: 0, height: 0 }, 56, 44)).toEqual({
      minX: DEFAULT_MIN,
      maxX: DEFAULT_MAX,
      minY: DEFAULT_MIN,
      maxY: DEFAULT_MAX,
    })
  })

  it('caps the margin below 0.5 so a tiny surface can never invert the bounds', () => {
    const bounds = boxClampBounds({ width: 40, height: 40 }, 56, 44)
    expect(bounds.minX).toBeLessThan(bounds.maxX)
    expect(bounds.minX).toBe(0.49)
  })
})

describe('clampPoint', () => {
  it('pulls an out-of-bounds stored point inside; leaves an interior point untouched', () => {
    const bounds = boxClampBounds({ width: 1000, height: 640 }, 56, 44)
    // An extreme corner card (0.01, 0.99) is pulled to the box edges.
    expect(clampPoint(0.01, 0.99, bounds)).toEqual({ x: bounds.minX, y: bounds.maxY })
    // A centred card is unchanged.
    expect(clampPoint(0.5, 0.5, bounds)).toEqual({ x: 0.5, y: 0.5 })
  })
})
