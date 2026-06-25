import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AiPrivacyNote } from './AiPrivacyNote'

describe('AiPrivacyNote', () => {
  it('discloses that text goes to Anthropic on the owner key', () => {
    render(<AiPrivacyNote />)
    expect(screen.getByText(/AI runs on the owner/)).toBeInTheDocument()
    expect(screen.getByText(/works fully without AI/)).toBeInTheDocument()
  })

  it('renders a compact variant', () => {
    render(<AiPrivacyNote compact />)
    expect(screen.getByText(/AI runs on the owner/)).toBeInTheDocument()
  })
})
