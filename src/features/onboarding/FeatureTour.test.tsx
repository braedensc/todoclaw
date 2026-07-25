import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeatureTour, type TourStep } from './FeatureTour'

// Anchors live on the page the tour points at — plant them before mounting the overlay, and
// sweep them between tests (they're appended outside RTL's auto-cleaned container).
function plantAnchors(...names: string[]) {
  for (const name of names) {
    const el = document.createElement('div')
    el.setAttribute('data-tour', name)
    document.body.appendChild(el)
  }
}

afterEach(() => {
  document.querySelectorAll('[data-tour]').forEach((el) => el.remove())
})

const STEPS: TourStep[] = [
  { target: 'alpha', title: 'First stop', body: 'Alpha body.' },
  { target: 'ghost', title: 'Never shown', body: 'No anchor at this breakpoint.' },
  { target: 'beta', title: 'Second stop', body: 'Beta body.' },
]

describe('FeatureTour', () => {
  it('walks the available steps, silently dropping targets that are not mounted', () => {
    plantAnchors('alpha', 'beta')
    const onClose = vi.fn()
    render(<FeatureTour steps={STEPS} onClose={onClose} />)

    // 'ghost' dropped → 2 steps, starting at the first.
    expect(screen.getByText('First stop')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Second stop')).toBeInTheDocument()

    // Back returns; Next → Finish completes.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('First stop')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(onClose).toHaveBeenCalledWith(true)
  })

  describe('`also` — the secondary call-out', () => {
    it('rings the named anchor alongside the spotlight, and clears it on the next step', () => {
      // The mobile bottom bar's reason for existing: a panel shows the surface, `also` says which
      // tab opens it. It must not linger onto a step that doesn't ask for one.
      plantAnchors('alpha', 'beta', 'nav-add')
      render(
        <FeatureTour
          steps={[
            { target: 'alpha', title: 'First stop', body: 'Alpha.', also: 'nav-add' },
            { target: 'beta', title: 'Second stop', body: 'Beta.' },
          ]}
          onClose={vi.fn()}
        />,
      )
      expect(screen.getByTestId('tour-also')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      expect(screen.queryByTestId('tour-also')).toBeNull()
    })

    it('ignores an `also` whose anchor is absent (a step shared across breakpoints)', () => {
      plantAnchors('alpha')
      render(
        <FeatureTour
          steps={[{ target: 'alpha', title: 'First stop', body: 'Alpha.', also: 'nav-add' }]}
          onClose={vi.fn()}
        />,
      )
      expect(screen.getByText('First stop')).toBeInTheDocument()
      expect(screen.queryByTestId('tour-also')).toBeNull()
    })
  })

  it('Skip tour closes without completing', () => {
    plantAnchors('alpha')
    const onClose = vi.fn()
    render(<FeatureTour steps={STEPS} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('Escape closes without completing', () => {
    plantAnchors('alpha')
    const onClose = vi.fn()
    render(<FeatureTour steps={STEPS} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('closes immediately when no step has an anchor', () => {
    const onClose = vi.fn()
    render(<FeatureTour steps={STEPS} onClose={onClose} />)
    expect(onClose).toHaveBeenCalledWith(false)
  })
})
