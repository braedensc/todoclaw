import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReminderPicker } from './ReminderPicker'

describe('ReminderPicker (multi-select)', () => {
  it('marks every selected offset pressed; Off is pressed only when nothing is selected', () => {
    const { rerender } = render(
      <ReminderPicker values={[]} onToggle={() => {}} onClear={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '1 hour' })).toHaveAttribute('aria-pressed', 'false')

    // Two offsets selected at once — both pressed, Off no longer pressed.
    rerender(<ReminderPicker values={[60, 1440]} onToggle={() => {}} onClear={() => {}} />)
    expect(screen.getByRole('button', { name: '1 hour' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '1 day' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '10 min' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('a preset chip toggles just its own offset; Off clears them all', () => {
    const onToggle = vi.fn()
    const onClear = vi.fn()
    render(<ReminderPicker values={[60]} onToggle={onToggle} onClear={onClear} />)

    fireEvent.click(screen.getByRole('button', { name: '1 day' }))
    expect(onToggle).toHaveBeenLastCalledWith(1440)
    fireEvent.click(screen.getByRole('button', { name: '1 hour' }))
    expect(onToggle).toHaveBeenLastCalledWith(60)
    fireEvent.click(screen.getByRole('button', { name: 'At time' }))
    expect(onToggle).toHaveBeenLastCalledWith(0)

    expect(onClear).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
