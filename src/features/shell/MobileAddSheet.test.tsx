import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Task } from '../../types/task'
import type { ChatController } from '../ai/use-chat-controller'
import { MobileAddSheet } from './MobileAddSheet'
import { quadrantMeta } from '../../lib/quadrants'

let tasksData: Task[] = []
const addMutate = vi.fn()

vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => ({ data: tasksData }),
  useAddTask: () => ({ mutate: addMutate }),
}))

function fakeChat(): ChatController {
  return {
    items: [],
    busy: false,
    pending: null,
    error: null,
    paused: false,
    send: vi.fn(),
    confirm: vi.fn(),
    deny: vi.fn(),
    seed: vi.fn(),
  }
}

function renderSheet(over: Partial<Parameters<typeof MobileAddSheet>[0]> = {}) {
  const onClose = vi.fn()
  const onOpenChat = vi.fn()
  render(
    <MobileAddSheet open chat={fakeChat()} onOpenChat={onOpenChat} onClose={onClose} {...over} />,
  )
  return { onClose, onOpenChat }
}

beforeEach(() => {
  tasksData = []
  addMutate.mockClear()
})

describe('MobileAddSheet', () => {
  it('defaults to the BabyClaw capture and offers a Manual toggle', () => {
    renderSheet()
    expect(screen.getByRole('group', { name: 'Add mode' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tell BabyClaw')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Manual/ })).toBeInTheDocument()
  })

  it('switches to the manual text + quadrant form', () => {
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: /Manual/ }))
    expect(screen.getByLabelText('Task text')).toBeInTheDocument()
    // The manual form's quadrant picker is present (its four targets).
    expect(screen.getByRole('button', { name: 'Schedule' })).toBeInTheDocument()
  })

  it('manual add creates a PLACED task in the chosen quadrant and closes', () => {
    const { onClose } = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: /Manual/ }))

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
