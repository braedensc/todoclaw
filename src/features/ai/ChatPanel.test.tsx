import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ChatItem, PendingConfirm } from './use-ai-chat'
import type { ChatController } from './use-chat-controller'
import { ChatPanel } from './ChatPanel'

// ChatPanel is now presentational (B8): the shell owns one shared conversation (useChatController)
// and passes it in, so both the inline BabyClaw reply and this popup stay in lockstep. The test
// hands it a fake controller directly — no hook mocking needed.
function chat(over: Partial<ChatController> = {}): ChatController {
  return {
    items: [] as ChatItem[],
    busy: false,
    pending: null as PendingConfirm | null,
    error: null as string | null,
    paused: false,
    send: vi.fn(),
    confirm: vi.fn(),
    deny: vi.fn(),
    ...over,
  }
}

describe('ChatPanel', () => {
  it('renders user/assistant bubbles and tool notes', () => {
    render(
      <ChatPanel
        chat={chat({
          items: [
            { id: '1', role: 'user', text: 'add dentist' },
            { id: '2', role: 'assistant', text: 'Added it.' },
            { id: '3', role: 'tool', text: 'Created "dentist".', ok: true },
          ],
        })}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('add dentist')).toBeInTheDocument()
    expect(screen.getByText('Added it.')).toBeInTheDocument()
    expect(screen.getByText(/Created "dentist"/)).toBeInTheDocument()
  })

  it('shows the confirmation banner and wires Confirm/Cancel', () => {
    const c = chat({ pending: { toolUseId: 'toolu_9', summary: 'Move "dentist" to the trash' } })
    render(<ChatPanel chat={c} onClose={vi.fn()} />)

    expect(screen.getByText(/Move "dentist" to the trash\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(c.confirm).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(c.deny).toHaveBeenCalled()
  })

  it('sends a message on submit', () => {
    const c = chat()
    render(<ChatPanel chat={c} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(c.send).toHaveBeenCalledWith('hello')
  })

  it('shows the paused notice and disables input when AI is paused', () => {
    render(<ChatPanel chat={chat({ paused: true })} onClose={vi.fn()} />)
    expect(screen.getByText(/AI is paused for this month/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toBeDisabled()
  })
})
