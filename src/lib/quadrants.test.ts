import { describe, expect, it } from 'vitest'
import { quadrantMeta } from './quadrants'

describe('quadrantMeta', () => {
  it('maps each of the four quadrants to its label and color', () => {
    expect(quadrantMeta(0.8, 0.8)).toEqual({ key: 'do-now', label: 'Do Now', color: '#bf5e2a' })
    expect(quadrantMeta(0.2, 0.8)).toEqual({
      key: 'schedule',
      label: 'Schedule',
      color: '#3d7a5f',
    })
    expect(quadrantMeta(0.8, 0.2)).toEqual({
      key: 'errands',
      label: 'Errands',
      color: '#7d6b1e',
    })
    expect(quadrantMeta(0.2, 0.2)).toEqual({
      key: 'someday',
      label: 'Someday',
      color: '#857c6e',
    })
  })

  it('treats the 0.5 boundary as the high side on both axes', () => {
    // Exactly (0.5, 0.5) is the most-urgent/most-important corner: Do Now.
    expect(quadrantMeta(0.5, 0.5).key).toBe('do-now')
    // x just below 0.5 with y at the boundary → Schedule.
    expect(quadrantMeta(0.49999, 0.5).key).toBe('schedule')
    // x at the boundary, y just below → Errands.
    expect(quadrantMeta(0.5, 0.49999).key).toBe('errands')
    // both just below → Someday.
    expect(quadrantMeta(0.49999, 0.49999).key).toBe('someday')
  })

  it('handles the extreme corners', () => {
    expect(quadrantMeta(0, 0).key).toBe('someday')
    expect(quadrantMeta(1, 1).key).toBe('do-now')
    expect(quadrantMeta(0, 1).key).toBe('schedule')
    expect(quadrantMeta(1, 0).key).toBe('errands')
  })
})
