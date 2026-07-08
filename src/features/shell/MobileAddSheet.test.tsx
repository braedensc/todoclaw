import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Task } from '../../types/task'
import { MobileAddSheet } from './MobileAddSheet'
import { quadrantMeta } from '../../lib/quadrants'

let tasksData: Task[] = []
const addMutate = vi.fn()

vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => ({ data: tasksData }),
  useAddTask: () => ({ mutate: addMutate }),
}))

function renderSheet(over: Partial<Parameters<typeof MobileAddSheet>[0]> = {}) {
  const onClose = vi.fn()
  render(<MobileAddSheet open onClose={onClose} {...over} />)
  return { onClose }
}

beforeEach(() => {
  tasksData = []
  addMutate.mockClear()
})

describe('MobileAddSheet', () => {
  it('shows the manual text + quadrant form directly, with no AI/BabyClaw toggle', () => {
    renderSheet()
    // AI capture lives in the Chat tab now — the add sheet is manual-only, no mode switcher.
    expect(screen.queryByRole('group', { name: 'Add mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Manual/ })).not.toBeInTheDocument()
    // The manual form is present from the start.
    expect(screen.getByLabelText('Task text')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schedule' })).toBeInTheDocument()
  })

  it('manual add creates a PLACED task in the chosen quadrant and closes', () => {
    const { onClose } = renderSheet()

    fireEvent.change(screen.getByLabelText('Task text'), { target: { value: 'file taxes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))

    expect(addMutate).toHaveBeenCalledTimes(1)
    const arg = addMutate.mock.calls[0]![0] as {
      text: string
      x: number
      y: number
      staged: boolean
    }
    expect(arg.text).toBe('file taxes')
    expect(arg.staged).toBe(false)
    expect(quadrantMeta(arg.x, arg.y).key).toBe('schedule')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
