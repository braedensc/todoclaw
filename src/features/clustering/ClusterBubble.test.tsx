import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ClusterBubble } from './ClusterBubble'
import type { Task } from '../../types/task'

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
    created_at: '2026-07-01T00:00:00Z',
    deleted_at: null,
    completed_at: null,
  }
}

function renderBubble({ open = false, onToggle = vi.fn() } = {}) {
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
})
