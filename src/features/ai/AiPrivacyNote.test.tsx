import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AiPrivacyNote } from './AiPrivacyNote'

describe('AiPrivacyNote', () => {
  it('discloses text goes to Anthropic, that chats + memory are saved, and how to control them', () => {
    render(<AiPrivacyNote />)
    expect(screen.getByText(/AI runs on the owner/)).toBeInTheDocument()
    // Conversations are now persisted (no longer "not saved") + deletable.
    expect(screen.getByText(/conversations are saved/i)).toBeInTheDocument()
    expect(screen.getByText(/delete any of them/i)).toBeInTheDocument()
    // Memory is saved, sent to Anthropic, and controllable in Settings.
    expect(screen.getByText(/Settings → AI/)).toBeInTheDocument()
    expect(screen.getByText(/works fully without AI/)).toBeInTheDocument()
  })

  it('renders a compact variant that still says chats are saved + controllable', () => {
    render(<AiPrivacyNote compact />)
    expect(screen.getByText(/AI runs on the owner/)).toBeInTheDocument()
    expect(screen.getByText(/conversations are saved/i)).toBeInTheDocument()
    expect(screen.getByText(/Settings → AI/)).toBeInTheDocument()
  })
})
