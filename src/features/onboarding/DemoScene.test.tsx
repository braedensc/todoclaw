import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ConfirmProvider } from '../../components/use-confirm'
import { ToastProvider } from '../../components/use-toast'
import { DemoScene } from './DemoScene'
import { DEMO_PLAN, DEMO_EVENING_REPLY } from './demo-transcript'
import { demoTour } from './tour-steps'

// jsdom has no matchMedia, so the real useIsMobile always reports desktop (the App.test.tsx
// pattern). The scene itself no longer has a breakpoint-shaped anchor (the closing "options" step
// now targets the REAL Account nav / bottom bar in App.tsx, not a copy mounted here) — App.test.tsx
// covers that split.
const mockIsMobile = vi.fn<() => boolean>(() => false)
vi.mock('../../hooks/use-is-mobile', () => ({
  useIsMobile: () => mockIsMobile(),
}))

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

/** The scene is aria-hidden scenery — role queries can't see it, so reach for anchors by hand. */
const anchor = (name: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`)
  if (!el) throw new Error(`no [data-tour="${name}"] anchor on the scene`)
  return el
}

describe('DemoScene', () => {
  beforeEach(() => {
    mockIsMobile.mockReturnValue(false)
    supabaseTouched.length = 0
  })

  it('renders the example board, plan, and both check-ins with zero backend traffic', () => {
    const onReady = renderScene()

    // The scene signalled readiness (App gates the FeatureTour mount on this).
    expect(onReady).toHaveBeenCalled()

    // Board (jsdom has no matchMedia → desktop grid): standalone cards render. ('Send the invoice'
    // appears twice by design — grid card + the plan's big rock — so the board-only spot checks use
    // tasks the plan doesn't mention.)
    expect(screen.getAllByText('Send the invoice').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Renew the passport')).toBeInTheDocument()
    expect(screen.getByText('Clean out the garage')).toBeInTheDocument()

    // The plan card renders the canned plan through the real PlanBox, under the example ✦ Plan My
    // Day button the tour's plan panel spotlights (button + result shown together). getByText, not
    // getByRole: the whole scene is aria-hidden scenery, so the button has no accessible role.
    expect(screen.getByText(/Plan My Day/)).toBeInTheDocument()
    expect(screen.getByText(DEMO_PLAN.headline)).toBeInTheDocument()

    // Both check-in moments play through the real chat surface. The evening recap acknowledges
    // the already-done big rock (✓) and lists what's still open.
    expect(screen.getByText(/Good morning!/)).toBeInTheDocument()
    expect(screen.getByText(/already crossed off:/)).toBeInTheDocument()
    expect(screen.getByText(/Still open from this morning's plan:/)).toBeInTheDocument()
    expect(screen.getByText(DEMO_EVENING_REPLY)).toBeInTheDocument()

    // The habits strip is the REAL RemindersInline over the seeded habits — not a lookalike — so
    // the tour shows the actual home-screen treatment. Scoped to its anchor: these labels are
    // generic and could otherwise match unrelated content.
    const habits = anchor('demo-habits')
    expect(within(habits).getByText('Stretch 10 minutes')).toBeInTheDocument()
    expect(within(habits).getByText('Walk the dog')).toBeInTheDocument()
    // The seeded habit_done map ticks exactly one → a partial "treats earned" tally. textContent,
    // not getByText: the tally is an <svg> plus three sibling text nodes.
    expect(habits.textContent).toContain('1/2')

    // Look-only: the chat composer is hidden in the demo cards.
    expect(screen.queryByLabelText('Message')).toBeNull()

    // Nothing ever reached for the Supabase client.
    expect(supabaseTouched).toEqual([])
  })

  it('mounts an anchor for every demo-* tour step, on BOTH breakpoints', () => {
    // The scripts' targets are identical across breakpoints (demo-content.test.ts pins that). The
    // closing step ('options') is deliberately excluded — it targets the REAL Account nav / bottom
    // bar in App.tsx, not anything DemoScene mounts; App.test.tsx covers that one.
    for (const isMobile of [false, true]) {
      mockIsMobile.mockReturnValue(isMobile)
      const { unmount } = render(
        <ConfirmProvider>
          <ToastProvider>
            <DemoScene onReady={vi.fn()} />
          </ToastProvider>
        </ConfirmProvider>,
      )
      for (const step of demoTour(isMobile).filter((s) => s.target.startsWith('demo-'))) {
        expect(
          document.querySelector(`[data-tour="${step.target}"]`),
          `${step.target} @ ${isMobile ? 'mobile' : 'desktop'}`,
        ).not.toBeNull()
      }
      unmount()
    }
  })
})
