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
import { MobileBottomNav } from '../shell/MobileBottomNav'
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

// DemoScene — the tour's "example day": a full-screen overlay showing what Todoclaw looks like in
// real use. The ENTIRE 8-panel tour plays over this one scene (no second leg over the user's own
// empty shell), so it also carries the "chrome" the later panels point at — the ✦ Plan My Day
// button and the options row. Everything else is the REAL components rendering fake in-memory data:
//
//   • the board — the real GridSurface (desktop) / MobileMatrix (mobile) fed by a nested,
//     pre-seeded TanStack QueryClient, so clustering, glow, ↻ / ❄️ badges and quadrant tints are
//     the live production code paths (a new card treatment shows up here for free);
//   • the plan — the real PlanBox with a canned, schema-valid plan (demo-transcript.ts), under an
//     example ✦ Plan My Day button (look-only) so the plan panel shows the button AND its result;
//   • the check-ins — the real ChatConversation playing the scripted morning push and evening
//     recap, whose texts are drift-guarded against the actual dispatch builders by a Deno test;
//   • the habits strip — the real RemindersInline over seeded habits, sitting right above the board
//     exactly as it does in the real shell (PlanBox → RemindersInline → WorkArea).
//
// The one thing the scene must FAKE is the options chrome (`demo-options`), because the real
// controls are wired to real handlers (navigate, sign out) and live in the shell this overlay is
// covering. It's look-only, and it's breakpoint-shaped, because the truth is: on desktop the
// options are the header's Account nav (top right); on mobile there IS no header nav — Chat/Done
// are bottom-bar tabs and habits/Settings live under "⋯ More" (ADR-0028). So desktop gets a copy of
// that nav row at the top and mobile mounts the REAL MobileBottomNav at the bottom, and the closing
// panel points each user at where their options actually are.
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

/**
 * The desktop options row — a look-only copy of the real shell's header nav (App.tsx's
 * `<nav aria-label="Account">`), so the closing panel points at the options without tearing the
 * example down to reach the real shell.
 *
 * Plain spans, not buttons, and no nav/aria-label: the real nav sits behind this overlay carrying
 * the IDENTICAL labels, so anything role-shaped here is a duplicate `getByRole('button', {name:
 * 'Settings'})` waiting to break a spec. (`aria-hidden` on the scene already hides it from role
 * queries — this is the second lock, since the scene losing that attribute shouldn't cascade into
 * a dozen red specs.)
 *
 * Admin is omitted (owner-only) and so is Chat's unread badge — a first-run user has neither, and
 * inventing them would put a lie in the "example".
 */
function DemoOptionsRow() {
  return (
    <div>
      {/* The anchor is the shrink-wrapped row itself (`w-fit`, pushed right by `ml-auto` the way
          the real header's justify-between puts it), NOT a full-width wrapper — the tour cuts its
          spotlight from the anchor's bounding box, and a full-width box would highlight a stretch
          of empty paper to the left of the options it's pointing at. */}
      <div
        data-tour="demo-options"
        className="ml-auto flex w-fit flex-wrap items-center gap-4 text-xs text-muted"
      >
        <span>
          <span aria-hidden>🐾</span> Chat
        </span>
        <span>
          <BoneIcon className="inline h-2.5 w-auto align-[-1px]" /> Daily habits
        </span>
        <span>
          <span aria-hidden>⚙</span> Settings
        </span>
        <span>
          <span aria-hidden>✓</span> Done
        </span>
        <span>Sign out</span>
      </div>
      {/* The hairline that closes the real masthead — it makes the row read as a header edge
          rather than a strip of words floating over the example. */}
      <div aria-hidden className="mt-3 h-px bg-ink/30" />
    </div>
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

        {/* Desktop: the options live along the top, so the scene's header edge does too. */}
        {!isMobile && <DemoOptionsRow />}

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

        {/* Mobile: the options are the bottom bar, so the scene grows the REAL one — look-only
            (every handler is a noop; the scene is inert), sticky to the scroller's bottom edge the
            way the real bar hugs the screen, and full-bleed past the column's padding. The negative
            bottom margin cancels the column's pb-24 so the bar's resting place is flush with the
            bottom rather than floating 96px above it at full scroll. */}
        {isMobile && (
          <div data-tour="demo-options" className="sticky bottom-0 z-10 -mx-4 -mb-24">
            <MobileBottomNav
              route="home"
              onHome={noop}
              onAdd={noop}
              onChat={noop}
              onDone={noop}
              onMore={noop}
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
