import { useEffect, useRef, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { localDateInTZ } from '../../lib/dates'
import { EMPTY_DAILY_STATE } from '../daily-state/use-daily-state'
import { useGrid } from '../grid/use-grid'
import { GridSurface } from '../grid/GridSurface'
import { MobileMatrix } from '../shell/MobileMatrix'
import type { QuadrantFocus } from '../shell/use-quadrant-focus'
import { RemindersInline } from '../habits/RemindersInline'
import { PlanBox } from '../ai/PlanBox'
import { ChatConversation } from '../ai/ChatConversation'
import type { ChatController } from '../ai/use-chat-controller'
import type { ChatItem } from '../ai/use-ai-chat'
import { buildDemoTasks, buildDemoHabits, DEMO_HABIT_DONE } from './demo-board'
import {
  DEMO_EVENING_CLOSE,
  DEMO_EVENING_REPLY,
  DEMO_EVENING_TOOL_NOTES,
  DEMO_MORNING,
  DEMO_PLAN,
  DEMO_RECAP,
  DEMO_TRANSCRIPT_DAY,
} from './demo-transcript'

// DemoScene — the tour's "example day": rendered INLINE in the real shell, right where App.tsx
// mounts it (below the real header, above the real board/plan/reminders it stands in for), so the
// real chrome around it — the masthead, the mascot mark, the header's Account nav / the mobile
// bottom bar — is never covered. It's not a portal or a fixed overlay; it's ordinary content in
// the page's own flow, which is exactly what makes the surrounding chrome "real" rather than a
// look-alike. App.tsx hides the REAL PlanBox/RemindersInline/WorkArea while the tour plays (they'd
// otherwise render a second board directly beneath this one) — see the `tour` guard there.
//
// Everything the scene shows is the REAL component rendering fake in-memory data:
//   • the board — the real GridSurface (desktop) / MobileMatrix (mobile) fed by a nested,
//     pre-seeded TanStack QueryClient, so clustering, glow, ↻ / ❄️ badges and quadrant tints are
//     the live production code paths (a new card treatment shows up here for free);
//   • the plan — the real PlanBox with a canned, schema-valid plan (demo-transcript.ts);
//   • the check-ins — the real ChatConversation playing the scripted morning push and evening
//     recap, whose texts are drift-guarded against the actual dispatch builders by a Deno test;
//   • the habits strip — the real RemindersInline over seeded habits, sitting right above the board
//     exactly as it does in the real shell (PlanBox → RemindersInline → WorkArea).
//
// The ONE thing that stays look-only is the ✦ Plan My Day button + the plan panel under it
// (`demo-plan`): a first-run user has no real plan yet, so the tour fakes "what it looks like once
// you have one" rather than pointing at the real header button's honest empty state. The real
// header's own Plan My Day button (or the mobile pill) is untouched and still shows the user's
// actual plan state the whole time the tour is up.
//
// The rest of the app's chrome — Chat / Daily habits / Settings / Done / Sign out (desktop header
// nav) and Home / Add / Chat / Done / More (mobile bottom bar) — is never faked: the closing tour
// panel spotlights those REAL controls directly (`data-tour="options"` on each), not a copy of them.
//
// ZERO backend traffic and zero AI spend by construction: the nested QueryClient seeds every key
// the mounted surfaces read and disables fetching outright (`enabled: false` — a missed key shows
// a quiet loading state rather than pulling the user's real data into the "example"), mutations
// can never fire because the scene is inert (and the FeatureTour overlay above swallows all input),
// and the chat is a plain fake controller. Unmounting leaves no trace — nothing was written anywhere.
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
  // Which habits are ticked off TODAY lives in daily_state, never on the habit row (that split is
  // what makes the daily reset non-destructive) — so the strip needs both halves seeded to show a
  // real, partly-done day instead of an untouched 0/2.
  client.setQueryData(['daily_state', today], { ...EMPTY_DAILY_STATE, habit_done: DEMO_HABIT_DONE })
  client.setQueryData(['user_schedule'], null)
  client.setQueryData(['task_reminders'], new Map<string, number[]>())
  client.setQueryData(['habits'], buildDemoHabits())
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

  return (
    <div
      className="flex flex-col gap-4"
      aria-hidden="true"
      // `inert` (set via ref — React 18 has no prop for it) keeps the scenery's buttons/inputs out
      // of the tab order and out of assistive tech; the FeatureTour overlay above swallows pointer
      // input for the real chrome around this, but this scene's OWN fake controls (the plan button)
      // must never be reachable either.
      ref={(el) => {
        if (el) el.inert = true
      }}
    >
      <QueryClientProvider client={client}>
        {/* The plan step spotlights this whole block — the ✦ Plan My Day button AND the plan it
            builds — so the tour shows the button and its result together. Look-only scenery: a
            first-run user has no real plan yet, so this fakes what one looks like. Styled like the
            real header pill. */}
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

        {/* The habits strip — the REAL RemindersInline, fed from the sealed cache. Same bet as
            the board: the live component means the actual home-screen treatment (paw checks, the
            bone "treats earned" tally, the desktop inline row vs. the mobile collapsible card) is
            what the tour shows, and a redesign lands here without anyone remembering to re-fake
            it. It sits between the plan and the board because that is exactly the real shell's
            order, so the panel's "right above your board" is literally true.
            MUST stay inside the QueryClientProvider: outside it, useHabits would bind to the
            app's real client and the "example" would fetch and display the user's OWN habits. */}
        <div data-tour="demo-habits">
          <RemindersInline />
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
    </div>
  )
}
