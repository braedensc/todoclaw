import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConfirmProvider } from '../../components/use-confirm'
import { ToastProvider } from '../../components/use-toast'
import { DemoScene } from './DemoScene'
import { DEMO_PLAN, DEMO_EVENING_REPLY } from './demo-transcript'
import { demoTour } from './tour-steps'

// The scene's whole contract: render the REAL surfaces from the sealed in-memory cache with ZERO
// backend traffic. The supabase module is replaced by a proxy that fails the test loudly on ANY
// touch — every query key the mounted components read must be pre-seeded (a queryFn firing, a
// mutation running, anything reaching for the client trips it). This is the tripwire for the
// classic drift: someone adds a new data hook to GridSurface/MobileMatrix and the demo silently
// starts pulling (or showing a loading hole for) the user's real data.
const supabaseTouched: string[] = []
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy(
    {},
    {
      get(_target, prop) {
        supabaseTouched.push(String(prop))
        throw new Error(`DemoScene touched supabase.${String(prop)} — seed that query key instead`)
      },
    },
  ),
}))

function renderScene(onReady = vi.fn()) {
  render(
    // The same providers App mounts above the shell (GridSurface needs useConfirm; the mutation
    // hooks created inside the demo cache need useToast).
    <ConfirmProvider>
      <ToastProvider>
        <DemoScene onReady={onReady} />
      </ToastProvider>
    </ConfirmProvider>,
  )
  return onReady
}

describe('DemoScene', () => {
  it('renders the example board, plan, and both check-ins with zero backend traffic', () => {
    const onReady = renderScene()

    // The scene signalled readiness (App gates the FeatureTour mount on this).
    expect(onReady).toHaveBeenCalled()

    // Board (jsdom has no matchMedia → desktop grid): standalone cards render; the framing ribbon
    // makes the fakeness explicit. ('Send the invoice' appears twice by design — grid card + the
    // plan's big rock — so the board-only spot checks use tasks the plan doesn't mention.)
    expect(screen.getAllByText('Send the invoice').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Renew the passport')).toBeInTheDocument()
    expect(screen.getByText('Clean out the garage')).toBeInTheDocument()
    expect(screen.getByText(/none of this is your data/i)).toBeInTheDocument()

    // The plan card renders the canned plan through the real PlanBox.
    expect(screen.getByText(DEMO_PLAN.headline)).toBeInTheDocument()

    // Both check-in moments play through the real chat surface.
    expect(screen.getByText(/Good morning!/)).toBeInTheDocument()
    expect(screen.getByText(/Which of these did you knock out today\?/)).toBeInTheDocument()
    expect(screen.getByText(DEMO_EVENING_REPLY)).toBeInTheDocument()

    // Look-only: the chat composer is hidden in the demo cards.
    expect(screen.queryByLabelText('Message')).toBeNull()

    // Nothing ever reached for the Supabase client.
    expect(supabaseTouched).toEqual([])
  })

  it('mounts an anchor for every demo tour step (the tour resolves them once, at mount)', () => {
    renderScene()
    // jsdom → desktop; the demo-* anchors are breakpoint-agnostic, so either script's targets work.
    for (const step of demoTour(false)) {
      expect(document.querySelector(`[data-tour="${step.target}"]`), step.target).not.toBeNull()
    }
  })
})
