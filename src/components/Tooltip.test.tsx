import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  it('shows a role=tooltip bubble after the delay and hides on leave', () => {
    vi.useFakeTimers()
    try {
      render(
        <Tooltip label="Save changes" delay={150}>
          <button type="button">save</button>
        </Tooltip>,
      )
      const btn = screen.getByRole('button', { name: 'save' })

      // Nothing before the dwell elapses.
      fireEvent.pointerEnter(btn)
      act(() => vi.advanceTimersByTime(100))
      expect(screen.queryByRole('tooltip')).toBeNull()

      act(() => vi.advanceTimersByTime(100))
      expect(screen.getByRole('tooltip')).toHaveTextContent('Save changes')

      fireEvent.pointerLeave(btn)
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a pending open if the pointer leaves before the delay', () => {
    vi.useFakeTimers()
    try {
      render(
        <Tooltip label="hi">
          <button type="button">x</button>
        </Tooltip>,
      )
      const btn = screen.getByRole('button', { name: 'x' })
      fireEvent.pointerEnter(btn)
      fireEvent.pointerLeave(btn)
      act(() => vi.advanceTimersByTime(500))
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows immediately on keyboard focus (no preceding pointer press)', () => {
    render(
      <Tooltip label="Save">
        <button type="button">x</button>
      </Tooltip>,
    )
    const btn = screen.getByRole('button', { name: 'x' })
    fireEvent.focus(btn)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Save')
    fireEvent.blur(btn)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('suppresses the focus bubble when focus trails a pointer press (a click)', () => {
    render(
      <Tooltip label="Save">
        <button type="button">x</button>
      </Tooltip>,
    )
    const btn = screen.getByRole('button', { name: 'x' })
    // Mouse click: pointerdown → focus. Hover, not focus, should own the mouse case.
    fireEvent.pointerDown(btn)
    fireEvent.focus(btn)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('dismisses on Escape while the trigger keeps focus', () => {
    vi.useFakeTimers()
    try {
      render(
        <Tooltip label="hi">
          <button type="button">x</button>
        </Tooltip>,
      )
      const btn = screen.getByRole('button', { name: 'x' })
      fireEvent.pointerEnter(btn)
      act(() => vi.advanceTimersByTime(300))
      expect(screen.getByRole('tooltip')).toBeInTheDocument()

      fireEvent.keyDown(btn, { key: 'Escape' })
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("preserves the child's own event handlers", () => {
    const onPointerEnter = vi.fn()
    render(
      <Tooltip label="hi">
        <button type="button" onPointerEnter={onPointerEnter}>
          x
        </button>
      </Tooltip>,
    )
    const btn = screen.getByRole('button', { name: 'x' })
    fireEvent.pointerEnter(btn)
    expect(onPointerEnter).toHaveBeenCalledOnce()
  })
})
