import { describe, expect, it } from 'vitest'
import { daypartFor } from './daypart'

// Boundary pins for the daypart buckets: night [21–5), morning [5–11), day [11–17),
// evening [17–21). The CSS tints in index.css assume exactly these names.
describe('daypartFor', () => {
  it('maps each boundary hour to its bucket', () => {
    expect(daypartFor(0)).toBe('night')
    expect(daypartFor(4)).toBe('night')
    expect(daypartFor(5)).toBe('morning')
    expect(daypartFor(10)).toBe('morning')
    expect(daypartFor(11)).toBe('day')
    expect(daypartFor(16)).toBe('day')
    expect(daypartFor(17)).toBe('evening')
    expect(daypartFor(20)).toBe('evening')
    expect(daypartFor(21)).toBe('night')
    expect(daypartFor(23)).toBe('night')
  })
})
