import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CardActionBar } from './CardActionBar'

// The action bar shared by the grid card and the cluster-popup rows. These lock the visual contract
// (outlined — NOT filled — green Done pill + quiet ⋯/×) and the drag-guard (every control stops a
// pointer-down) so the two surfaces can't drift and a tap on a control never starts a drag.

function noop() {}

describe('CardActionBar', () => {
  it('renders an OUTLINED "Done" pill (label + green border/text, not filled) plus ⋯ and ×', () => {
    render(
      <CardActionBar
        doneAction="archive"
        onDone={noop}
        onMenu={noop}
        onDelete={noop}
        menuLabel="Edit task"
      />,
    )

    const done = screen.getByRole('button', { name: 'Mark done' })
    expect(done).toHaveTextContent('Done')
    // Green border + green text, deliberately NOT a solid green fill (that reads as "already done").
    expect(done.className).toContain('border-primary')
    expect(done.className).toContain('text-primary')
    expect(done.className).not.toMatch(/(^|\s)bg-primary(\s|$)/)

    expect(screen.getByRole('button', { name: 'Edit task' })).toHaveTextContent('⋯')
    expect(screen.getByRole('button', { name: 'Delete task' })).toHaveTextContent('×')
  })

  it('fires onDone / onMenu / onDelete when the matching control is clicked', () => {
    const onDone = vi.fn()
    const onMenu = vi.fn()
    const onDelete = vi.fn()
    render(
      <CardActionBar
        doneAction="archive"
        onDone={onDone}
        onMenu={onMenu}
        onDelete={onDelete}
        menuLabel="Edit task"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))

    expect(onDone).toHaveBeenCalledOnce()
    expect(onMenu).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('labels the Done control "resets clock" when recurring', () => {
    render(
      <CardActionBar
        doneAction="recurring-cycle"
        onDone={noop}
        onMenu={noop}
        onDelete={noop}
        menuLabel="Due date and recurring"
      />,
    )
    expect(screen.getByRole('button', { name: 'Mark done (resets clock)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument()
  })

  // An ONGOING project's ✓ is not a completion — it logs "I worked on this today", so the pill says
  // WORKED and, once today is banked, fills and reads as a pressed toggle you can tap to undo.
  it('labels the control "Worked" for an ongoing project, unfilled until today is logged', () => {
    render(
      <CardActionBar
        doneAction="work-session"
        onDone={noop}
        onMenu={noop}
        onDelete={noop}
        menuLabel="Due date and recurring"
      />,
    )
    const worked = screen.getByRole('button', { name: 'Log that you worked on this today' })
    expect(worked).toHaveTextContent('Worked')
    expect(worked).toHaveAttribute('aria-pressed', 'false')
    expect(worked.className).not.toMatch(/(^|\s)bg-primary(\s|$)/)
  })

  it('fills the control and offers undo once a session is logged today', () => {
    const onDone = vi.fn()
    render(
      <CardActionBar
        doneAction="work-session"
        workedToday
        onDone={onDone}
        onMenu={noop}
        onDelete={noop}
        menuLabel="Due date and recurring"
      />,
    )
    const worked = screen.getByRole('button', { name: 'Worked on this today — click to undo' })
    // The VISIBLE word does not change between the two states — only the fill and aria-pressed do.
    // A longer "Worked today" label wrapped to a second line on a grid card and grew the card the
    // moment a session was logged, which is precisely what logging a session must never do.
    expect(worked).toHaveTextContent('Worked')
    expect(worked).toHaveAttribute('aria-pressed', 'true')
    expect(worked.className).toMatch(/(^|\s)bg-primary(\s|$)/)

    fireEvent.click(worked)
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('as a popover trigger (menuOpen set) advertises aria-haspopup + aria-expanded and shows the menu content', () => {
    render(
      <CardActionBar
        doneAction="archive"
        onDone={noop}
        onMenu={noop}
        onDelete={noop}
        menuLabel="Due date and recurring"
        menuOpen
        menuContent={<div data-testid="menu-content">picker</div>}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Due date and recurring' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('menu-content')).toBeInTheDocument()
  })

  it('as a plain trigger (no menuOpen) carries neither aria-haspopup nor aria-expanded', () => {
    render(
      <CardActionBar
        doneAction="archive"
        onDone={noop}
        onMenu={noop}
        onDelete={noop}
        menuLabel="Edit task"
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Edit task' })
    expect(trigger).not.toHaveAttribute('aria-haspopup')
    expect(trigger).not.toHaveAttribute('aria-expanded')
  })

  it('every control stops a pointer-down from reaching the drag-handle parent', () => {
    const onParentPointerDown = vi.fn()
    render(
      <div onPointerDown={onParentPointerDown}>
        <CardActionBar
          doneAction="archive"
          onDone={noop}
          onMenu={noop}
          onDelete={noop}
          menuLabel="Edit task"
        />
      </div>,
    )

    for (const name of ['Mark done', 'Edit task', 'Delete task']) {
      fireEvent.pointerDown(screen.getByRole('button', { name }))
    }
    expect(onParentPointerDown).not.toHaveBeenCalled()
  })
})
