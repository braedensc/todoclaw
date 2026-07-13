import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIsMobile } from '../../hooks/use-is-mobile'
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
} from './demo-transcript'

// DemoScene — the tour's "example day": a full-screen overlay showing what Todoclaw looks like in
// real use, BEFORE the walkthrough points at the user's own (empty) shell. Everything on it is the
// REAL component rendering fake in-memory data:
//
//   • the board — the real GridSurface (desktop) / MobileMatrix (mobile) fed by a nested,
//     pre-seeded TanStack QueryClient, so clustering, glow, ↻ / ❄️ badges and quadrant tints are
//     the live production code paths (a new card treatment shows up here for free);
//   • the plan — the real PlanBox with a canned, schema-valid plan (demo-transcript.ts);
//   • the check-ins — the real ChatConversation playing the scripted morning push and evening
//     recap, whose texts are drift-guarded against the actual dispatch builders by a Deno test.
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
    busy: false,
    pending: null,
    error: null,
    paused: false,
    send: noop,
    confirm: noop,
    deny: noop,
    seed: noop,
  }
}

// A proactive message opens in chat as `${title}\n\n${body}` (the App.tsx seed effect) — the demo
// bubbles reproduce exactly that.
const MORNING_ITEMS: ChatItem[] = [
  { id: 'demo-m1', role: 'assistant', text: `${DEMO_MORNING.title}\n\n${DEMO_MORNING.body}` },
]
const EVENING_ITEMS: ChatItem[] = [
  { id: 'demo-e1', role: 'assistant', text: `${DEMO_RECAP.title}\n\n${DEMO_RECAP.body}` },
  { id: 'demo-e2', role: 'user', text: DEMO_EVENING_REPLY },
  ...DEMO_EVENING_TOOL_NOTES.map(
    (text, i): ChatItem => ({ id: `demo-e-tool-${i}`, role: 'tool', text, ok: true }),
  ),
  { id: 'demo-e3', role: 'assistant', text: DEMO_EVENING_CLOSE },
]

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
          <div data-tour="demo-plan">
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
            items={EVENING_ITEMS}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
