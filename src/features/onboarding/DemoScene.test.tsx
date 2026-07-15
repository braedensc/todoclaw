import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ConfirmProvider } from '../../components/use-confirm'
import { ToastProvider } from '../../components/use-toast'
import { DemoScene } from './DemoScene'
import { DEMO_PLAN, DEMO_EVENING_REPLY } from './demo-transcript'
import { demoTour } from './tour-steps'

// jsdom has no matchMedia, so the real useIsMobile always reports desktop (the App.test.tsx
// pattern). The scene's options chrome is the one thing shaped per breakpoint — a header-nav row on
// desktop, the real bottom bar on mobile — so the mobile path needs a way in: without this, a typo
// in that branch would drop the closing panel's anchor on phones and NOTHING would catch it (the
// golden tour spec is desktop-only too).
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

    // Board (jsdom has no matchMedia → desktop grid): standalone cards render; the framing ribbon
    // makes the fakeness explicit. ('Send the invoice' appears twice by design — grid card + the
    // plan's big rock — so the board-only spot checks use tasks the plan doesn't mention.)
    expect(screen.getAllByText('Send the invoice').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Renew the passport')).toBeInTheDocument()
    expect(screen.getByText('Clean out the garage')).toBeInTheDocument()
    expect(screen.getByText(/none of this is your data/i)).toBeInTheDocument()

    // The plan card renders the canned plan through the real PlanBox, under the example ✦ Plan My
    // Day button the tour's plan panel spotlights (button + result shown together). getByText, not
    // getByRole: the whole scene is aria-hidden scenery, so the button has no accessible role.
    expect(screen.getByText(/Plan My Day/)).toBeInTheDocument()
    expect(screen.getByText(DEMO_PLAN.headline)).toBeInTheDocument()

    // Both check-in moments play through the real chat surface.
    expect(screen.getByText(/Good morning!/)).toBeInTheDocument()
    expect(screen.getByText(/Which of these did you knock out today\?/)).toBeInTheDocument()
    expect(screen.getByText(DEMO_EVENING_REPLY)).toBeInTheDocument()

    // The habits strip is the REAL RemindersInline over the seeded habits — not a lookalike — so
    // the tour shows the actual home-screen treatment. Scoped to its anchor: these labels are
    // generic, and demo chrome must never be asserted with a bare getByText (see the options row).
    const habits = anchor('demo-habits')
    expect(within(habits).getByText('Stretch 10 minutes')).toBeInTheDocument()
    expect(within(habits).getByText('Walk the dog')).toBeInTheDocument()
    // The seeded habit_done map ticks exactly one → a partial "treats earned" tally. textContent,
    // not getByText: the tally is an <svg> plus three sibling text nodes.
    expect(habits.textContent).toContain('1/2')

    // Desktop options: a look-only copy of the header nav, so the closing panel points at the
    // scene instead of tearing it down to reach the real shell.
    expect(within(anchor('demo-options')).getByText(/Settings/)).toBeInTheDocument()

    // Look-only: the chat composer is hidden in the demo cards.
    expect(screen.queryByLabelText('Message')).toBeNull()

    // Nothing ever reached for the Supabase client.
    expect(supabaseTouched).toEqual([])
  })

  it('mounts an anchor for every demo tour step, on BOTH breakpoints', () => {
    // The scripts' targets are identical across breakpoints (demo-content.test.ts pins that), but
    // the ELEMENTS behind demo-options are not — desktop's header-nav row vs. mobile's bottom bar —
    // so both renders have to be checked or half the coverage is imaginary.
    for (const isMobile of [false, true]) {
      mockIsMobile.mockReturnValue(isMobile)
      const { unmount } = render(
        <ConfirmProvider>
          <ToastProvider>
            <DemoScene onReady={vi.fn()} />
          </ToastProvider>
        </ConfirmProvider>,
      )
      for (const step of demoTour(isMobile)) {
        expect(
          document.querySelector(`[data-tour="${step.target}"]`),
          `${step.target} @ ${isMobile ? 'mobile' : 'desktop'}`,
        ).not.toBeNull()
      }
      unmount()
    }
  })

  it('mounts the real bottom bar as the options chrome on mobile (there is no header nav there)', () => {
    mockIsMobile.mockReturnValue(true)
    renderScene()

    // The real MobileBottomNav, look-only: the tabs a phone user actually taps to reach the rest of
    // the app. "More" is the one the closing panel's mobile copy sends them to for habits/Settings.
    const options = anchor('demo-options')
    expect(within(options).getByText('Chat')).toBeInTheDocument()
    expect(within(options).getByText('Done')).toBeInTheDocument()
    expect(within(options).getByText('More')).toBeInTheDocument()
    // The desktop-only header row must NOT also be on the scene — two options anchors would make
    // the closing panel spotlight whichever came first in the document.
    expect(document.querySelectorAll('[data-tour="demo-options"]')).toHaveLength(1)

    expect(supabaseTouched).toEqual([])
  })
})
