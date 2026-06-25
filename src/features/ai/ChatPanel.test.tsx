import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ChatItem, PendingConfirm } from './use-ai-chat'

const statusMock = vi.fn()
vi.mock('./use-ai-status', () => ({ useAiStatus: () => statusMock() }))

const chatMock = vi.fn()
vi.mock('./use-ai-chat', () => ({ useAiChat: () => chatMock() }))

import { ChatPanel } from './ChatPanel'

function chat(over: Partial<ReturnType<typeof base>> = {}) {
  return { ...base(), ...over }
}
function base() {
  return {
    items: [] as ChatItem[],
    busy: false,
    pending: null as PendingConfirm | null,
    error: null as string | null,
    send: vi.fn(),
    confirm: vi.fn(),
    deny: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  statusMock.mockReturnValue({ data: { paused: false } })
})

describe('ChatPanel', () => {
  it('renders user/assistant bubbles and tool notes', () => {
    chatMock.mockReturnValue(
      chat({
        items: [
          { id: '1', role: 'user', text: 'add dentist' },
          { id: '2', role: 'assistant', text: 'Added it.' },
          { id: '3', role: 'tool', text: 'Created "dentist".', ok: true },
        ],
      }),
    )
    render(<ChatPanel onClose={vi.fn()} />)
    expect(screen.getByText('add dentist')).toBeInTheDocument()
    expect(screen.getByText('Added it.')).toBeInTheDocument()
    expect(screen.getByText(/Created "dentist"/)).toBeInTheDocument()
  })

  it('shows the confirmation banner and wires Confirm/Cancel', () => {
    const c = chat({ pending: { toolUseId: 'toolu_9', summary: 'Move "dentist" to the trash' } })
    chatMock.mockReturnValue(c)
    render(<ChatPanel onClose={vi.fn()} />)

    expect(screen.getByText(/Move "dentist" to the trash\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(c.confirm).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(c.deny).toHaveBeenCalled()
  })

  it('sends a message on submit', () => {
    const c = chat()
    chatMock.mockReturnValue(c)
    render(<ChatPanel onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(c.send).toHaveBeenCalledWith('hello')
  })

  it('shows the paused notice and disables input when AI is paused', () => {
    statusMock.mockReturnValue({ data: { paused: true } })
    chatMock.mockReturnValue(chat())
    render(<ChatPanel onClose={vi.fn()} />)
    expect(screen.getByText(/AI is paused for this month/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toBeDisabled()
  })
})
