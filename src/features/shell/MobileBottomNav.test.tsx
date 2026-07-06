import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MobileBottomNav } from './MobileBottomNav'

describe('MobileBottomNav', () => {
  function setup() {
    const onAdd = vi.fn()
    const onReminders = vi.fn()
    const onDone = vi.fn()
    const onMore = vi.fn()
    render(
      <MobileBottomNav onAdd={onAdd} onReminders={onReminders} onDone={onDone} onMore={onMore} />,
    )
    return { onAdd, onReminders, onDone, onMore }
  }

  it('exposes Done inside a nav labelled "Account" (the golden openDone contract)', () => {
    setup()
    const nav = screen.getByRole('navigation', { name: 'Account' })
    // Mirrors e2e openDone: getByRole('navigation',{name:'Account'}).getByRole('button',{name:'Done'}).
    expect(within(nav).getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('renders the four thumb-zone actions and wires each callback', () => {
    const { onAdd, onReminders, onDone, onMore } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reminders' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onReminders).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onMore).toHaveBeenCalledTimes(1)
  })
})
