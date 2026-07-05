import { Component, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfirmProvider, useConfirm } from './use-confirm'

// A tiny consumer that asks for confirmation and reports the resolved boolean, so the tests can
// assert the promise settles to true/false through the real dialog.
function Consumer({ onResult }: { onResult: (ok: boolean) => void }) {
  const confirm = useConfirm()
  return (
    <button type="button" onClick={async () => onResult(await confirm({ title: 'Delete this?' }))}>
      ask
    </button>
  )
}

function renderConsumer(onResult: (ok: boolean) => void) {
  render(
    <ConfirmProvider>
      <Consumer onResult={onResult} />
    </ConfirmProvider>,
  )
}

describe('useConfirm', () => {
  it('opens the themed dialog and resolves true when confirmed', async () => {
    const onResult = vi.fn()
    renderConsumer(onResult)

    fireEvent.click(screen.getByText('ask'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Delete this?')

    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/ }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
    // The dialog closes once the choice settles.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('resolves false when cancelled', async () => {
    const onResult = vi.fn()
    renderConsumer(onResult)

    fireEvent.click(screen.getByText('ask'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/i }))

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('resolves false when dismissed with Escape', async () => {
    const onResult = vi.fn()
    renderConsumer(onResult)

    fireEvent.click(screen.getByText('ask'))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
  })

  it('throws when used outside a ConfirmProvider', () => {
    // Catch the render error in a boundary (so it doesn't propagate as an uncaught jsdom error)
    // and silence React's dev-mode error log for a clean run.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let caught: Error | undefined
    class Catch extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false }
      static getDerivedStateFromError(error: Error) {
        caught = error
        return { failed: true }
      }
      render() {
        return this.state.failed ? null : this.props.children
      }
    }
    function Bare() {
      useConfirm()
      return null
    }
    render(
      <Catch>
        <Bare />
      </Catch>,
    )
    expect(caught?.message).toMatch(/ConfirmProvider/)
    spy.mockRestore()
  })
})
