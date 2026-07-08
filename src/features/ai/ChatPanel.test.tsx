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
    seed: vi.fn(),
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

    // BabyClaw's own replies carry his decorative 🐾 mark; the user's messages don't.
    expect(screen.getByText('Added it.').closest('li')?.textContent).toContain('🐾')
    expect(screen.getByText('add dentist').closest('li')?.textContent).not.toContain('🐾')
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

  it('keeps the input usable while a confirmation is pending — a typed yes/no answers it', () => {
    // send() is pending-aware (use-ai-chat routes it to confirm/deny), so the box must stay open.
    const c = chat({ pending: { toolUseId: 'toolu_9', summary: 'Move "dentist" to the trash' } })
    render(<ChatPanel chat={c} onClose={vi.fn()} />)

    const input = screen.getByLabelText('Message')
    expect(input).not.toBeDisabled()
    expect(input.getAttribute('placeholder')).toMatch(/yes or no/i)
    fireEvent.change(input, { target: { value: 'yes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(c.send).toHaveBeenCalledWith('yes')
  })

  it("hides BabyClaw's trailing [[status: …]] line from the bubble", () => {
    render(
      <ChatPanel
        chat={chat({
          items: [
            {
              id: '1',
              role: 'assistant',
              text: 'Added it — due Friday!\n[[status: Added "call mom" 🐾]]',
            },
          ],
        })}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Added it — due Friday!')).toBeInTheDocument()
    expect(screen.queryByText(/\[\[status/)).not.toBeInTheDocument()
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
