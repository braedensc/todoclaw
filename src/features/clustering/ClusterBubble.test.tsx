import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ClusterBubble } from './ClusterBubble'
import type { GlowStyle, StaleRingStyle } from '../../lib/visual-urgency'
import type { Task } from '../../types/task'

// A stand-in overdue glow (shape matches urgencyGlowStyle('overdue')): ring + pulse + warm tint.
const OVERDUE_GLOW: GlowStyle = {
  boxShadow: '0 0 0 4px rgba(194,105,63,1)',
  animation: 'urgency-pulse 2s ease-in-out infinite',
  background: '#fff1e8',
}

// A stand-in cool-blue stale ring + icy tint (shape matches staleRingStyle's deepest rung).
const STALE_RING: StaleRingStyle = {
  boxShadow: '0 0 0 3px rgba(50,118,205,0.95), 0 0 28px 7px rgba(50,118,205,0.55)',
  background: '#e0edfb',
}

// The contract under test: pointer events inside the bubble must NOT reach the grid canvas.
// The canvas dismisses any open popup on pointerdown (GridView.handleGridPointerDown), so a
// leaked pointerdown closed the popup before the button's click could toggle it — clicking an
// open bubble closed-then-instantly-reopened instead of toggling closed.

function task(id: string): Task {
  return {
    id,
    user_id: 'u1',
    text: `Task ${id}`,
    x: 0.5,
    y: 0.5,
    due: null,
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    ongoing: false,
    created_at: '2026-07-01T00:00:00Z',
    deleted_at: null,
    completed_at: null,
    start_date: null,
  }
}

function renderBubble({
  open = false,
  onToggle = vi.fn(),
  glow = null as GlowStyle | null,
  staleRing = null as StaleRingStyle | null,
} = {}) {
  const onSurfacePointerDown = vi.fn()
  const onSurfaceClick = vi.fn()
  render(
    // Stand-in for the grid canvas: the parent that must never see the bubble's events.
    <div onPointerDown={onSurfacePointerDown} onClick={onSurfaceClick}>
      <ClusterBubble
        group={[task('a'), task('b')]}
        accentColor="#bf5e2a"
        screenX={0.5}
        screenY={0.5}
        open={open}
        onToggle={onToggle}
        glow={glow}
        staleRing={staleRing}
      />
    </div>,
  )
  return { onSurfacePointerDown, onSurfaceClick, onToggle }
}

describe('ClusterBubble', () => {
  it('shows the stack count and an expanded state', () => {
    renderBubble({ open: true })
    const button = screen.getByRole('button', { name: '2 tasks stacked here' })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveTextContent('2')
  })

  it('toggles on click without the click reaching the surface', () => {
    const { onSurfaceClick, onToggle } = renderBubble()
    fireEvent.click(screen.getByRole('button', { name: '2 tasks stacked here' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onSurfaceClick).not.toHaveBeenCalled()
  })

  it('stops pointerdown from reaching the surface (the popup-dismiss handler)', () => {
    const { onSurfacePointerDown } = renderBubble({ open: true })
    fireEvent.pointerDown(screen.getByRole('button', { name: '2 tasks stacked here' }))
    expect(onSurfacePointerDown).not.toHaveBeenCalled()
  })

  // A clustered urgent task should read like a standalone card: the CLOSED bubble takes the full
  // ring + pulse + warm tint from the glow prop.
  it('applies the urgency ring, pulse, and warm tint while closed', () => {
    renderBubble({ open: false, glow: OVERDUE_GLOW })
    const button = screen.getByRole('button', { name: '2 tasks stacked here' })
    expect(button.style.boxShadow).toBe(OVERDUE_GLOW.boxShadow)
    expect(button.style.animation).toContain('urgency-pulse')
    expect(button.style.background).toBeTruthy()
  })

  // Opening the bubble drops the tint/pulse for its raised popup shadow (no ring animation crowding
  // the open popup).
  it('drops the tint and pulse once open', () => {
    renderBubble({ open: true, glow: OVERDUE_GLOW })
    const button = screen.getByRole('button', { name: '2 tasks stacked here' })
    expect(button.style.animation).toBe('')
    expect(button.style.background).toBe('')
  })

  // A STALE cluster gains the same cool-blue ring its coldest folded card would show —
  // composed on top of the urgency glow (own hue lane), only while closed.
  it('composes the stale ring over the glow while closed, and drops it when open', () => {
    const { rerender } = render(
      <ClusterBubble
        group={[task('a'), task('b')]}
        accentColor="#bf5e2a"
        screenX={0.5}
        screenY={0.5}
        open={false}
        onToggle={vi.fn()}
        glow={OVERDUE_GLOW}
        staleRing={STALE_RING}
      />,
    )
    const button = screen.getByRole('button', { name: '2 tasks stacked here' })
    // Closed: both the warm glow ring and the cool-blue stale ring are present.
    expect(button.style.boxShadow).toContain('rgba(194,105,63,1)')
    expect(button.style.boxShadow).toContain('rgba(50,118,205,0.95)')

    rerender(
      <ClusterBubble
        group={[task('a'), task('b')]}
        accentColor="#bf5e2a"
        screenX={0.5}
        screenY={0.5}
        open
        onToggle={vi.fn()}
        glow={OVERDUE_GLOW}
        staleRing={STALE_RING}
      />,
    )
    // Open: raised popup shadow only — no stale ring.
    expect(button.style.boxShadow).not.toContain('rgba(50,118,205,0.95)')
  })

  // With no glow, the stale ring + icy tint still compose over the bubble's resting shadow.
  it('shows the stale ring + icy tint over the resting shadow when there is no glow', () => {
    renderBubble({ open: false, staleRing: STALE_RING })
    const button = screen.getByRole('button', { name: '2 tasks stacked here' })
    expect(button.style.boxShadow).toContain('rgba(50,118,205,0.95)')
    expect(button.style.boxShadow).toContain('rgba(0,0,0,.10)')
    expect(button.style.background).toBe('rgb(224, 237, 251)') // #e0edfb
  })
})
