import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { BoneIcon } from '../../components/BoneIcon'
import { localDateInTZ } from '../../lib/dates'
import { EMPTY_DAILY_STATE } from '../daily-state/use-daily-state'
import { useGrid } from '../grid/use-grid'
import { GridSurface } from '../grid/GridSurface'
import { MobileMatrix } from '../shell/MobileMatrix'
import type { QuadrantFocus } from '../shell/use-quadrant-focus'
import { PlanBox } from '../ai/PlanBox'
import { ChatConversation } from '../ai/ChatConversation'
import type { ChatController } from '../ai/use-chat-controller'
import type { ChatItem } from '../ai/use-ai-chat'
import { buildDemoTasks } from './demo-board'
import {
  DEMO_EVENING_CLOSE,
  DEMO_EVENING_REPLY,
  DEMO_EVENING_TOOL_NOTES,
  DEMO_MORNING,
  DEMO_PLAN,
  DEMO_RECAP,
  DEMO_TRANSCRIPT_DAY,
} from './demo-transcript'

// DemoScene — the tour's "example day": a full-screen overlay showing what Todoclaw looks like in
// real use. The ENTIRE 9-panel tour plays over this one scene (no second leg over the user's own
// empty shell), so it also carries the "chrome" the later panels point at — the Plan My Day button,
// an example Daily-habits card, and an example Settings card. The core surfaces are the REAL
// components rendering fake in-memory data:
//
//   • the board — the real GridSurface (desktop) / MobileMatrix (mobile) fed by a nested,
//     pre-seeded TanStack QueryClient, so clustering, glow, ↻ / ❄️ badges and quadrant tints are
//     the live production code paths (a new card treatment shows up here for free);
//   • the plan — the real PlanBox with a canned, schema-valid plan (demo-transcript.ts), under an
//     example ✦ Plan My Day button (look-only) so the plan panel shows the button AND its result;
//   • the check-ins — the real ChatConversation playing the scripted morning push and evening
//     recap, whose texts are drift-guarded against the actual dispatch builders by a Deno test;
//   • habits + settings — small look-only example cards (`demo-habits` / `demo-settings`) the last
//     two panels spotlight, so the tour never has to jump to the real shell.
//
// ZERO backend traffic and zero AI spend by construction: the nested QueryClient seeds every key
// the mounted surfaces read and disables fetching outright (`enabled: false` — a missed key shows
// a quiet loading state rather than pulling the user's real data into the "example"), mutations
// can never fire because the scene is inert (and the tour overlay above swallows all input), and
// the chat is a plain fake controller. Unmounting leaves no trace — nothing was written anywhere.
//
// The scene sits at z-[90]: above the shell's chrome (mobile nav z-40, header overlays z-50),
// below the FeatureTour overlay (z-[105]) that spotlights the `data-tour="demo-*"` anchors. Those
// wrapper anchors are the ONLY targets the demo tour script uses — never 'grid'/'matrix', which
// also exist in the real shell underneath (first-match-in-document-order would be ambiguous).
//
// Accessibility: the whole scene is decorative scenery (inert + aria-hidden) — the tour card
// (role="dialog", aria-modal) carries the narration for screen readers.

const noop = () => {}

const DEMO_QUADRANT_FOCUS: QuadrantFocus = {
  focus: null,
  enter: noop,
  switchTo: noop,
  exit: noop,
  clear: noop,
}

// A look-only stand-in for the shell's shared conversation (the ChatPanel.test.tsx pattern).
function demoChat(items: ChatItem[]): ChatController {
  return {
    items,
    liveItems: items, // the demo is all "this visit" — status/flash read liveItems
    busy: false,
    pending: null,
    error: null,
    paused: false,
    sessionId: null,
    activeSession: null,
    send: noop,
    confirm: noop,
    deny: noop,
    seed: noop,
    openSession: noop,
    newChat: noop,
  }
}

// A proactive message opens in chat as `${title}\n\n${body}` (the App.tsx seed effect) — the demo
// bubbles reproduce exactly that.
const MORNING_ITEMS: ChatItem[] = [
  { id: 'demo-m1', role: 'assistant', text: `${DEMO_MORNING.title}\n\n${DEMO_MORNING.body}` },
]

// The recap title/close name a weekday ("Wrapping up Monday"). The demo board is authored relative
// to the REAL today and the shell dateline (visible around the scene) shows the real weekday, so a
// fixed "Monday" would read stale on a Thursday. Swap the pinned day for the viewer's actual one at
// render time — the constants stay verbatim for the Deno drift test (which pins the fixed day).
function buildEveningItems(): ChatItem[] {
  const today = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date())
  const localize = (s: string) => s.split(DEMO_TRANSCRIPT_DAY).join(today)
  return [
    {
      id: 'demo-e1',
      role: 'assistant',
      text: `${localize(DEMO_RECAP.title)}\n\n${localize(DEMO_RECAP.body)}`,
    },
    { id: 'demo-e2', role: 'user', text: DEMO_EVENING_REPLY },
    ...DEMO_EVENING_TOOL_NOTES.map(
      (text, i): ChatItem => ({ id: `demo-e-tool-${i}`, role: 'tool', text, ok: true }),
    ),
    { id: 'demo-e3', role: 'assistant', text: localize(DEMO_EVENING_CLOSE) },
  ]
}

/**
 * The nested, sealed QueryClient the demo surfaces read from. Seeds every query key the mounted
 * components use; `enabled: false` + Infinity staleness guarantee no queryFn ever runs, so the
 * user's real Supabase data can never bleed into (or be touched by) the example.
 */
function makeDemoClient(timeZone: string): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        enabled: false,
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  // useDailyState keys by the LIVE local date in the user's zone; the demo schedule row is null,
  // so useTimeZone falls back to the browser zone — seed with the same date that fallback computes.
  const today = localDateInTZ(timeZone)
  client.setQueryData(['tasks'], buildDemoTasks(timeZone))
  client.setQueryData(['daily_state', today], EMPTY_DAILY_STATE)
  client.setQueryData(['user_schedule'], null)
  client.setQueryData(['task_reminders'], new Map<string, number[]>())
  client.setQueryData(['habits'], [])
  client.setQueryData(['history'], [])
  return client
}

// Desktop board: the same useGrid + GridSurface pairing WorkArea mounts, minus the input widget.
function DemoBoardDesktop() {
  const gridRef = useRef<HTMLDivElement>(null)
  const grid = useGrid(gridRef)
  return (
    <GridSurface
      grid={grid}
      gridRef={gridRef}
      view="grid"
      onSelectView={noop}
      gridOnly={false}
      onExitGridOnly={noop}
    />
  )
}

function DemoChatCard({
  tourId,
  caption,
  items,
}: {
  tourId: string
  caption: string
  items: ChatItem[]
}) {
  return (
    <section
      data-tour={tourId}
      className="flex flex-col overflow-hidden rounded-[14px] border border-border bg-panel"
    >
      <p className="border-b border-border bg-card px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {caption}
      </p>
      <ChatConversation chat={demoChat(items)} onClose={noop} showClose={false} readOnly />
    </section>
  )
}

export function DemoScene({ onReady }: { onReady: () => void }) {
  const isMobile = useIsMobile()
  // Built once per mount; the browser zone is exactly useTimeZone's fallback for a null schedule.
  const [client] = useState(() => makeDemoClient(Intl.DateTimeFormat().resolvedOptions().timeZone))
  // Evening bubbles localize the weekday to today — computed once per mount (reads the clock).
  const [eveningItems] = useState(buildEveningItems)

  // Signal readiness AFTER the first commit: App mounts the FeatureTour only then, so the tour's
  // once-at-mount anchor resolution always sees the demo-* anchors (a tour mounted alongside the
  // scene would silently drop every step — see FeatureTour's robustness rules).
  useEffect(() => {
    onReady()
  }, [onReady])

  return createPortal(
    <div
      className="fixed inset-0 z-[90] overflow-y-auto bg-bg"
      aria-hidden="true"
      // `inert` (set via ref — React 18 has no prop for it) keeps the scenery's buttons/inputs out
      // of the tab order and out of assistive tech; the tour overlay above swallows pointer input.
      ref={(el) => {
        if (el) el.inert = true
      }}
    >
      <div className="pointer-events-none mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-24 wide:max-w-[980px] wide:p-6">
        {/* The framing ribbon — the one thing that must never be missable: this is an example.
            Sticky, so it stays pinned while the tour scrolls the scene from board to check-ins. */}
        <div className="sticky top-2 z-10 rounded-full border border-border-strong bg-panel px-4 py-2 text-center text-[13px] font-medium text-ink shadow-sm">
          <span aria-hidden>👀</span> An example day in Todoclaw — none of this is your data. Your
          board starts fresh.
        </div>

        <QueryClientProvider client={client}>
          {/* The plan step spotlights this whole block — the ✦ Plan My Day button AND the plan it
              builds — so the tour shows the button and its result together. The button is example
              scenery (the scene is inert), styled like the real header pill. */}
          <div data-tour="demo-plan" className="flex flex-col items-center gap-3">
            <button
              type="button"
              className="whitespace-nowrap rounded-full px-6 py-3 text-sm font-medium text-white"
              style={{ backgroundImage: 'linear-gradient(135deg, #2e2a24 20%, #2c4a3a 115%)' }}
            >
              <span aria-hidden className="text-[#e8c47a]">
                ✦
              </span>{' '}
              Plan My Day
            </button>
            <div className="w-full">
              <PlanBox
                plan={DEMO_PLAN}
                paused={false}
                isPending={false}
                isError={false}
                onRetry={noop}
                onDismiss={noop}
                mobile={isMobile}
              />
            </div>
          </div>

          <div data-tour="demo-board">
            {isMobile ? <MobileMatrix quadrantFocus={DEMO_QUADRANT_FOCUS} /> : <DemoBoardDesktop />}
          </div>
        </QueryClientProvider>

        {/* Two moments of the same conversation — the morning push and the evening check-in. */}
        <div className="grid grid-cols-1 gap-4 wide:grid-cols-2">
          <DemoChatCard
            tourId="demo-chat-morning"
            caption="☀️ 8:00 AM — the plan arrives on its own"
            items={MORNING_ITEMS}
          />
          <DemoChatCard
            tourId="demo-chat-evening"
            caption="🌙 8:30 PM — the evening check-in"
            items={eveningItems}
          />
        </div>

        {/* The last two panels point here — example Daily habits + Settings, so the whole tour is
            one section over this scene (no jump to the real, empty shell). Look-only scenery. */}
        <div className="grid grid-cols-1 gap-4 wide:grid-cols-2">
          <section
            data-tour="demo-habits"
            className="overflow-hidden rounded-[14px] border border-border bg-panel"
          >
            <p className="border-b border-border bg-card px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              <BoneIcon className="inline h-2.5 w-auto align-[-1px]" /> Daily habits
            </p>
            <ul className="flex flex-col gap-2.5 p-4 text-[13px] text-ink">
              <li className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] text-white">
                  🐾
                </span>
                Stretch — 10 minutes
              </li>
              <li className="flex items-center gap-2.5 text-muted">
                <span className="h-6 w-6 rounded-full border border-border-strong" />
                Walk the dog
              </li>
            </ul>
          </section>

          <section
            data-tour="demo-settings"
            className="overflow-hidden rounded-[14px] border border-border bg-panel"
          >
            <p className="border-b border-border bg-card px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              <span aria-hidden>⚙</span> Settings
            </p>
            <ul className="flex flex-col gap-2 p-4 text-[13px] text-muted">
              <li>Daily reset — 4:00 AM</li>
              <li>Notifications — on</li>
              <li>Timezone, backups, and this tour</li>
            </ul>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
