import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { Task } from '../../types/task'
import { TouchCardPopover } from './TouchCardPopover'

// The popover is a controlled, anchored portal — render it directly with an anchor stub. jsdom
// lays out at 0px, so getBoundingClientRect is stubbed for a real anchor rect.

function makeTask(over: Partial<Task>): Task {
  return {
    id: 'id-' + Math.random().toString(36).slice(2),
    user_id: 'u1',
    text: 'A task',
    x: 0.5,
    y: 0.5,
    due: null,
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    ongoing: false,
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    deleted_at: null,
    completed_at: null,
    start_date: null,
    ...over,
  }
}

function anchorStub() {
  const el = document.createElement('div')
  el.getBoundingClientRect = () =>
    ({
      left: 300,
      top: 200,
      width: 112,
      height: 90,
      right: 412,
      bottom: 290,
      x: 300,
      y: 200,
    }) as DOMRect
  return { current: el } as React.RefObject<HTMLElement | null>
}

const handlers = () => ({
  onClose: vi.fn(),
  onDone: vi.fn(),
  onDelete: vi.fn(),
  onRename: vi.fn(),
  onSetDue: vi.fn(),
  onSetRecurring: vi.fn(),
  onSetFrequency: vi.fn(),
  onRemoveRecurring: vi.fn(),
  onSetOngoing: vi.fn(),
  onSetStartDate: vi.fn(),
  onToggleReminder: vi.fn(),
  onClearReminders: vi.fn(),
})

function renderPopover(
  task: Task,
  over: Partial<ReturnType<typeof handlers>> & { paused?: boolean } = {},
) {
  const h = { ...handlers(), ...over }
  render(
    <TouchCardPopover
      task={task}
      paused={over.paused ?? false}
      anchorRef={anchorStub()}
      reflowKey={0}
      daysUntilDue={null}
      minutesUntilDue={null}
      timeZone="America/New_York"
      reminderOffsets={[]}
      {...h}
    />,
  )
  return h
}

afterEach(() => vi.clearAllMocks())

describe('TouchCardPopover', () => {
  it('renders the actions and positions itself (visible after measuring)', () => {
    renderPopover(makeTask({ text: 'Do the thing' }))
    const popover = screen.getByTestId('touch-card-popover')
    expect(popover).toHaveAccessibleName('Task: Do the thing')
    expect(popover.style.visibility).toBe('visible')
    expect(within(popover).getByRole('button', { name: /✓ Done/ })).toBeInTheDocument()
    expect(within(popover).getByRole('button', { name: /⋯ Schedule/ })).toBeInTheDocument()
    expect(within(popover).getByRole('button', { name: 'Delete task' })).toBeInTheDocument()
  })

  it('Done and Delete fire their handlers', () => {
    const h = renderPopover(makeTask({ text: 'Act' }))
    fireEvent.click(screen.getByRole('button', { name: /✓ Done/ }))
    expect(h.onDone).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(h.onDelete).toHaveBeenCalledTimes(1)
  })

  it('tap-the-title rename commits through onRename', () => {
    const h = renderPopover(makeTask({ text: 'Old' }))
    fireEvent.click(screen.getByRole('button', { name: /Old/ }))
    const input = screen.getByRole('textbox', { name: 'Task name' })
    fireEvent.change(input, { target: { value: 'New' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(h.onRename).toHaveBeenCalledWith('New')
  })

  it('a paused card is read-only: Schedule + Delete but no Done', () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    renderPopover(makeTask({ text: 'Napping', start_date: future }), { paused: true })
    const popover = screen.getByTestId('touch-card-popover')
    expect(within(popover).queryByRole('button', { name: /✓ Done/ })).toBeNull()
    expect(within(popover).getByRole('button', { name: /⋯ Schedule/ })).toBeInTheDocument()
    expect(within(popover).getByRole('button', { name: 'Delete task' })).toBeInTheDocument()
  })

  it('a pointerdown outside the popover closes it; inside does not', () => {
    const h = renderPopover(makeTask({ text: 'Keep open' }))
    fireEvent.pointerDown(screen.getByTestId('touch-card-popover'))
    expect(h.onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it('outside-dismiss survives a stopPropagation on the press (capture-phase listener)', () => {
    // A grid card / action-bar control stops pointerdown propagation; a bubble-phase document
    // listener would be swallowed (React 18 delegates at #root). The capture-phase listener must
    // still fire so tapping another card dismisses the popover.
    const h = renderPopover(makeTask({ text: 'Dismiss me' }))
    const outside = document.createElement('button')
    outside.addEventListener('pointerdown', (e) => e.stopPropagation())
    document.body.appendChild(outside)
    fireEvent.pointerDown(outside)
    expect(h.onClose).toHaveBeenCalledTimes(1)
    outside.remove()
  })
})
