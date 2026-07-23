import { useEffect, useRef, useState } from 'react'
import { AuthGate } from './features/auth/AuthGate'
import { useSession } from './features/auth/use-session'
import { useEnsureUserSchedule } from './features/schedule/use-user-schedule'
import { TimezoneMismatchBanner } from './features/schedule/TimezoneMismatchBanner'
import { RemindersInline } from './features/habits/RemindersInline'
import { RemindersPage } from './features/habits/RemindersPage'
import { RemindersSheet } from './features/habits/RemindersSheet'
import { WorkArea } from './features/shell/WorkArea'
import { MobileBottomNav } from './features/shell/MobileBottomNav'
import { MoreSheet } from './features/shell/MoreSheet'
import { MobileAddSheet } from './features/shell/MobileAddSheet'
import { useQuadrantFocus } from './features/shell/use-quadrant-focus'
import { useGridOnly } from './features/shell/use-grid-only'
import { useIsMobile } from './hooks/use-is-mobile'
import { useLockedViewportGuard } from './hooks/use-locked-viewport-guard'
import { useAppHeight } from './hooks/use-app-height'
import { BACKGROUND_DISMISS_ATTR } from './hooks/use-background-dismiss'
import { ToastProvider, useToast } from './components/use-toast'
import { quadrantMeta, type QuadrantKey } from './lib/quadrants'
import { QUADRANT_CENTER } from './lib/quadrant-summary'
import { BoneIcon } from './components/BoneIcon'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TodoClawPeek } from './components/TodoClawPeek'
import { ConfirmProvider, useConfirm } from './components/use-confirm'
import { PlanBox } from './features/ai/PlanBox'
import { Thinking } from './components/Thinking'
import { usePlanController } from './features/ai/use-plan-controller'
import { useChatController } from './features/ai/use-chat-controller'
import { useTimeZone } from './features/schedule/use-time-zone'
import { ChatPanel } from './features/ai/ChatPanel'
import { ChatRail } from './features/ai/ChatRail'
import type { ChatView } from './features/ai/ChatConversation'
import { DonePage } from './features/done/DonePage'
import { DoneSheet } from './features/done/DoneSheet'
import { SettingsPanel } from './features/settings/SettingsPanel'
import { SetupGuide } from './features/onboarding/SetupGuide'
import { FeatureTour } from './features/onboarding/FeatureTour'
import { DemoScene } from './features/onboarding/DemoScene'
import { ADD_TASK_SPOTLIGHT, demoTour } from './features/onboarding/tour-steps'
import { markTourDone } from './features/onboarding/setup-guide-store'
import { useMarkTourSeen } from './features/onboarding/use-mark-tour-seen'
import { AdminPage } from './features/admin/AdminPage'
import { useIsOwner } from './features/auth/use-is-owner'
import { useRoute, useChatMessageId, navigate, goBack } from './lib/route'
import { supabase } from './lib/supabase'
import {
  useMessages,
  useUnreadCount,
  useMarkMessageRead,
  useOpenMessageChat,
} from './features/notifications/use-messages'

// Plan My Day pill (style mix): the ink fill warmed with a deep-green cast toward one corner,
// the ✦ picked out in gold — the header's one quiet "AI moment". Shared by the mobile and
// desktop headers so the pill is identical at every width.
const planPillStyle = { backgroundImage: 'linear-gradient(135deg, #2e2a24 20%, #2c4a3a 115%)' }

// The signed-in app shell (B8 layout): header (wordmark + Plan My Day + quiet Reminders/Settings/
// Done/Backups/Sign out links), the persistent Plan card top-center, the work region (a compact
// inline reminders list + one input widget + the Grid⇄List swap with its embedded toggle). Daily
// reminders live off the main page now — the inline names open per-reminder detail cards. Kept
// separate from App so the ensure-schedule effect only runs once a session exists.
//
// Done and Daily reminders are hash routes (`useRoute`, ADR-0027) presented as overlays over a
// still-mounted home — a centered popup on desktop, a slide-up sheet on mobile — so the browser
// Back button (or a scrim click) pops them back to home. Settings / Backups / Chat stay as
// route-independent overlays.
function AppShell() {
  const route = useRoute()
  const [showChat, setShowChat] = useState(false)
  // Which face the chat drawer opens on. Owned HERE, not inside ChatConversation, because the
  // ENTRY POINT decides: the nav Chat entry means "go to my chats" (the list), while the widget's
  // "Open chat" and a #/chat/<id> deep link mean one specific conversation. It also has to be
  // settable per open — the desktop rail stays mounted and slides off (ChatRail), so drawer-local
  // state would keep whatever face it was left on and a later nav click couldn't re-aim it.
  const [chatView, setChatView] = useState<ChatView>('conversation')
  const [showSettings, setShowSettings] = useState(false)
  // Set when Settings should open scrolled to a specific section (the setup guide's
  // "Turn on notifications" deep-link); cleared on close so a normal open starts at the top.
  const [settingsSection, setSettingsSection] = useState<'notifications' | undefined>(undefined)
  // The owner-only Admin panel is a route (`/#/admin`), not an overlay — invites now live inside it.
  // isOwner only reveals the entry point; the admin Edge Function enforces the real OWNER_USER_ID
  // gate server-side.
  const isOwner = useIsOwner()
  // The mobile "More" overflow sheet (Settings / Backups / Sign out) and the "+" add sheet.
  const [showMore, setShowMore] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  // The spotlight walkthroughs: 'demo' = the one-section tour over the example-day scene (DemoScene)
  // narrated by demoTour — finishing OR skipping it latches the guide's tour step; 'demo-solo' = the
  // same tour launched as the empty-state "See an example" peek (closes back to home, latches
  // nothing); 'add-task' = the single-step "Show me where" spotlight on the Task Manager. Launched
  // only from the home route, so every anchor the scripts name is mounted.
  const [tour, setTour] = useState<'demo' | 'demo-solo' | 'add-task' | null>(null)
  // DemoScene renders inline where the real PlanBox/RemindersInline/WorkArea normally sit — those
  // real surfaces are hidden while it plays so the tour doesn't stack a second board underneath the
  // example one. Chrome outside this (header, mascot, Account nav / bottom bar, and the real Plan My
  // Day button itself) stays exactly as it always is — DemoScene mounts around it, not over it.
  const demoActive = tour === 'demo' || tour === 'demo-solo'
  // The demo tour may mount only AFTER the scene's first commit (FeatureTour resolves anchors
  // once, at mount — a tour racing the scene would silently drop every demo-* step).
  const [demoReady, setDemoReady] = useState(false)
  // Mobile overview→focus state (which quadrant list is open). App-owned so Back pops it and the
  // add sheet pre-selects it; inert on desktop (nothing ever calls enter there).
  const quadrantFocus = useQuadrantFocus()
  // Transient confirmation pill ("Added to Errands ✓") floated above the bottom nav — the add
  // sheet closes instantly and the task may land in a quadrant that isn't on screen (audit §4.2).
  // The pill (and the shared <Snackbar>) now live in ToastProvider so error toasts from failed task
  // writes reach every surface, not just this mobile add flow.
  const showToast = useToast()
  // Grid-only view: the grid goes fullscreen and everything else on the shell is hidden. Entered
  // from the header pill (desktop) or the More sheet's "Grid view" row (mobile); left via the
  // overlay's ✕ pill, Esc, or the system Back gesture — the mode holds one state-flagged history
  // entry (use-grid-only), so ✕/Esc route through history.back() like quadrant focus does.
  const { gridOnly, enter: enterGridOnly, exit: exitGridOnly } = useGridOnly()
  // Below 720px the tall header is replaced by a slim top bar + a thumb-zone bottom nav (Concept D,
  // ADR-0026). JS-gated (not just CSS) so exactly one Account nav renders per environment — keeping
  // the golden `openDone` selector unambiguous and desktop untouched.
  const isMobile = useIsMobile()
  // The mobile shell is a locked, never-scrolling viewport (index.css) — but iOS can still pan the
  // window while revealing a focused input and leave that offset behind after the keyboard closes,
  // which floats the bottom nav above the true screen bottom. Snap back whenever that happens.
  useLockedViewportGuard(isMobile)
  // Size that locked shell to the MEASURED viewport (`--app-h`): in the installed PWA the
  // standalone viewport flips between screen-minus-top-inset and full screen, so any static CSS
  // unit either floats the bottom nav (dvh, short state) or clips it off the physical screen
  // (lvh, the iPhone-15-Pro-Max "too tiny" bug). See use-app-height.ts for the measured numbers.
  useAppHeight(isMobile)
  const { markSeen: markTourSeen } = useMarkTourSeen()
  const ensureSchedule = useEnsureUserSchedule()
  const timeZone = useTimeZone()
  const planner = usePlanController(timeZone)
  // Masthead dateline — "Tuesday — July 7, 2026" in the user's own timezone (the same zone all
  // "today" logic uses), so the printed day always matches the daily reset. Computed per render;
  // it only needs to be right for the session's day, not tick over live at midnight.
  const now = new Date()
  const dateline = `${now.toLocaleDateString('en-US', { weekday: 'long', timeZone })} — ${now.toLocaleDateString(
    'en-US',
    { month: 'long', day: 'numeric', year: 'numeric', timeZone },
  )}`
  // One conversation for the whole shell — shared by the inline BabyClaw reply and the chat popup.
  const chat = useChatController()
  // Proactive messages (ADR-0031) no longer have a separate inbox — the chat drawer IS the inbox
  // (its "See all chats" list shows them). `messages` still feeds the #/chat deep-link resolver
  // below; the unread count rides on the Chat entry (desktop nav badge + mobile Chat-tab dot).
  const messages = useMessages()
  const unread = useUnreadCount()
  const markRead = useMarkMessageRead()
  const confirm = useConfirm()
  // The plan pill persists once a plan is on screen, flipping its label to "Re-plan my day" (same
  // sleek pill). Re-planning DISCARDS the current plan, so a confirmation popup warns before an
  // accidental regenerate; the first plan of the day has nothing to lose and generates straight
  // away. Shared by the desktop header pill and the mobile top pill (both call handlePlanClick).
  const hasPlan = Boolean(planner.displayPlan)
  const handlePlanClick = async () => {
    if (
      hasPlan &&
      !(await confirm({
        title: 'Replace your current plan?',
        message:
          "Your current plan will be lost. Re-planning builds a new one from today's tasks, habits, and schedule.",
        confirmLabel: 'Re-plan my day',
        tone: 'default',
      }))
    )
      return
    planner.generate()
  }
  // Sign out sits one tap deep in the mobile More sheet, right under Backups — a mis-tap used to
  // cost a full re-login (audit §4.7). Same guard on the desktop header link for consistency.
  const confirmSignOut = async () => {
    if (await confirm({ title: 'Sign out of TodoClaw?', confirmLabel: 'Sign out' }))
      void supabase.auth.signOut()
  }

  // Guarantee a user_schedule row exists on first authenticated load — the daily reset depends on
  // its timezone. Idempotent (upsert ignoreDuplicates); runs once on mount.
  const ensure = ensureSchedule.mutate
  useEffect(() => {
    ensure()
  }, [ensure])

  // A `#/chat/<id>` deep link (a notification tap or an inbox click) opens that message's OWN
  // persistent BabyClaw conversation — never seeds it onto whatever chat happened to resume. Keyed on
  // the message id itself (useChatMessageId), NOT the collapsed 'chat' route, so opening message B
  // while message A is up re-fires (the old route-keyed effect silently dropped B). openSession clears
  // any prior live/seed/pending state, so no leak between messages. The overlay is shown by chatOpen
  // (below), so this effect only resolves the session + marks read.
  const openSession = chat.openSession
  const mark = markRead.mutate
  const openMsgChat = useOpenMessageChat().mutate
  const chatMsgId = useChatMessageId()
  const openedMsgRef = useRef<string | null>(null)
  // A deep link names ONE conversation, so aim the drawer at it — a notification tapped while the
  // drawer was last left on the list would otherwise resolve the session behind the list. Done on
  // the TRANSITION to a new link (guarded by state, adjusted during render — React's sanctioned
  // derive-from-changed-props pattern) so that "See all chats" still works while a deep link is up,
  // and so it isn't a set-state-in-effect. The guard is state, not a ref: a ref would survive
  // StrictMode's discarded first render pass and swallow the update.
  const [aimedMsgId, setAimedMsgId] = useState<string | null>(null)
  if (chatMsgId !== aimedMsgId) {
    setAimedMsgId(chatMsgId)
    if (chatMsgId) setChatView('conversation')
  }
  useEffect(() => {
    if (!chatMsgId) {
      openedMsgRef.current = null // left the deep link — allow reopening the same message later
      return
    }
    if (openedMsgRef.current === chatMsgId || !messages.data) return
    const msg = messages.data.find((m) => m.id === chatMsgId)
    if (!msg) return // not among the loaded messages — leave the drawer on its current conversation
    openedMsgRef.current = chatMsgId
    if (!msg.read_at) mark(chatMsgId)
    // Already materialised → jump straight to it; otherwise create-and-open (seeds BabyClaw's message
    // as the opening assistant turn), then switch to the returned session.
    if (msg.session_id) openSession(msg.session_id)
    else
      openMsgChat(chatMsgId, {
        onSuccess: (sid) => openSession(sid),
        onError: () => showToast("Couldn't open that message — try again.", 'error'),
      })
  }, [chatMsgId, messages.data, openSession, mark, openMsgChat, showToast])

  // Esc leaves grid-only mode (the overlay covers the header, so the ✕ pill, Back, and this are
  // the exits). Routes through history like the ✕ pill so the mode's entry is consumed.
  useEffect(() => {
    if (!gridOnly) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitGridOnly()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gridOnly, exitGridOnly])

  // The chat overlay is open via the WorkArea button (showChat) OR a #/chat deep link (route). Both
  // the desktop push-drawer and the mobile sheet key off this; closing clears both. A deep-linked
  // chat closes via goBack() — POPPING the chat hash entry, like the Done/Reminders overlays —
  // rather than pushing a fresh home entry: the push arrived as a null-state forward popstate that
  // use-grid-only/use-quadrant-focus can't tell from their own entry being popped, so closing a
  // notification chat over grid-only mode silently collapsed the grid (touch-grid review). goBack
  // still lands on home for a cold deep link (hasNavigatedWithinApp guard in lib/route).
  const chatOpen = showChat || route === 'chat'
  const closeChat = () => {
    setShowChat(false)
    if (route === 'chat') goBack()
  }
  // The two ways to open the drawer, each naming the face it wants. Every opener goes through one
  // of these so no caller can open the drawer without saying what it's opening ON.
  const openChatList = () => {
    setChatView('history')
    setShowChat(true)
  }
  const openChatConversation = () => {
    setChatView('conversation')
    setShowChat(true)
  }

  return (
    // Full-width shell so the desktop chat push-drawer (ChatRail, fixed to the viewport's right
    // edge) can pair with an animated right-padding on the main content: opening chat pads the
    // content by the drawer width, shrinking the grid column so the grid reflows left (B2). The
    // centered, max-width column lives on the INNER wrapper. On mobile the drawer is a covering
    // bottom-sheet (ChatPanel), so no padding is applied (`wide:` only).
    //
    // min-h-screen is desktop-only: on mobile the page is locked to the viewport and #root is the
    // scroll container (src/index.css), so a 100vh min-height here would force ~a safe-area's
    // worth of permanent overflow — i.e. the standalone-PWA scroll wiggle this replaces.
    <div
      className={
        isMobile
          ? // Mobile: a fixed-height flex COLUMN so the bottom nav (its last in-flow child) always
            // hugs the true bottom edge — see index.css. Content scrolls in the flex-1 region below.
            'relative flex h-full w-full flex-col'
          : 'relative min-h-full w-full wide:min-h-screen'
      }
    >
      <div
        // Page background — the gutters either side of the centered column, and any space below the
        // content. Pressing it closes the open desktop chat rail (ChatRail/useBackgroundDismiss);
        // only a press on this exact element counts, so everything inside still acts normally.
        {...{ [BACKGROUND_DISMISS_ATTR]: true }}
        className={
          (isMobile
            ? 'min-h-0 flex-1 overflow-y-auto overscroll-none '
            : 'min-h-full wide:min-h-screen ') +
          'transition-[padding] duration-300 ease-out ' +
          (chatOpen ? 'wide:pr-[420px]' : '')
        }
      >
        {/* A focused column: wide enough that the desktop grid is dominant (aspect-locked ≈
            1046/640 so clustering feel matches — #75), centered, with the header/plan/input above
            it. Raised from 1120 → 1280 to grow the grid into the space the removed habits strip
            freed (B2). */}
        {/* The bottom nav is now an in-flow flex child (below), not a fixed overlay, so the content
            column no longer needs a pb-28 spacer to clear it. */}
        <div
          // The column's own padding is background too — same exact-target rule as the wrapper above.
          {...{ [BACKGROUND_DISMISS_ATTR]: true }}
          className="mx-auto max-w-3xl p-6 wide:max-w-[1280px]"
        >
          {/* Home vs. an overlay. 'home' renders the header, plan, inline reminders, and work area.
              The 'chat' route is home + the chat overlay — a notification tap must land on the main
              screen with the drawer open, not a blank shell. 'reminders' (Daily habits) AND 'done'
              are ALWAYS overlays over a still-mounted home — a centered popup on desktop
              (RemindersPage / DonePage), a slide-up sheet on mobile (RemindersSheet / DoneSheet) —
              so you can click or swipe out of either back to home. Settings / Backups and the mobile
              bottom nav below are route-independent. */}
          {(route === 'home' || route === 'chat' || route === 'reminders' || route === 'done') && (
            <>
              {/* Above the masthead on both surfaces: prompt when the device clock and the
                  stored timezone disagree (hidden in grid-only — that mode strips all chrome). */}
              {!gridOnly && <TimezoneMismatchBanner />}
              {isMobile ? (
                // Mobile masthead: mirrors the desktop paper look now that the top bar is freed up.
                // A small-caps dateline, the wordmark grown around a bigger peeking pup with the
                // terracotta claw-swipe + tagline beneath, and a decorative paw trail filling the
                // hard-to-reach top-right corner. The bell moved into the More sheet; the Plan My Day
                // pill sits just below this masthead (near the logo) so it — and its "Re-plan my day"
                // state — stay reachable at the top of the screen.
                !gridOnly && (
                  <header className="mb-4 mt-1">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                      {dateline}
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h1
                          className="flex items-center gap-1 whitespace-nowrap font-serif text-[26px] font-semibold text-ink"
                          style={{ fontVariationSettings: "'opsz' 60" }}
                        >
                          <TodoClawPeek
                            playful
                            className="-my-1 h-12 w-12 shrink-0 drop-shadow-sm"
                          />
                          TodoClaw
                          <span aria-hidden className="-ml-1 text-accent">
                            .
                          </span>
                        </h1>
                        {/* Terracotta claw-swipe under the wordmark (aligned past the mark). */}
                        <svg
                          className="ml-[52px] block"
                          width="104"
                          height="12"
                          viewBox="0 0 118 14"
                          aria-hidden="true"
                        >
                          <path
                            d="M2,4 Q58,15 114,3"
                            stroke="#c2693f"
                            strokeWidth="2.6"
                            strokeLinecap="round"
                            fill="none"
                            opacity="0.9"
                          />
                          <path
                            d="M8,8 Q56,17 104,7"
                            stroke="#c2693f"
                            strokeWidth="2"
                            strokeLinecap="round"
                            fill="none"
                            opacity="0.55"
                          />
                          <path
                            d="M16,12 Q54,18 88,11"
                            stroke="#c2693f"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            fill="none"
                            opacity="0.3"
                          />
                        </svg>
                        <p className="mt-1.5 font-serif text-[14px] italic text-muted">
                          Where your tasks learn to sit and stay.
                        </p>
                      </div>
                      {/* Decorative paw trail — fills the corner, purely ornamental (no action). */}
                      <svg
                        width="56"
                        height="56"
                        viewBox="0 0 56 56"
                        aria-hidden="true"
                        className="shrink-0 text-muted-faint"
                      >
                        <g fill="currentColor">
                          <g opacity="0.7">
                            <ellipse cx="16" cy="22" rx="5.2" ry="4.2" />
                            <circle cx="9.5" cy="15" r="2.1" />
                            <circle cx="15" cy="11.5" r="2.3" />
                            <circle cx="21" cy="13.5" r="2.1" />
                            <circle cx="24.5" cy="19" r="1.9" />
                          </g>
                          <g opacity="0.4">
                            <ellipse cx="38" cy="42" rx="5.2" ry="4.2" />
                            <circle cx="31.5" cy="35" r="2.1" />
                            <circle cx="37" cy="31.5" r="2.3" />
                            <circle cx="43" cy="33.5" r="2.1" />
                            <circle cx="46.5" cy="39" r="1.9" />
                          </g>
                        </g>
                      </svg>
                    </div>
                  </header>
                )
              ) : (
                <header className="mb-3">
                  {/* Masthead dateline (style mix) — a small-caps folio strip above the wordmark,
                      like a morning paper's date line. Hidden in grid-only along with the rest of
                      the masthead trim (the fullscreen overlay covers the header anyway). */}
                  {!gridOnly && (
                    <div className="mb-3 border-y border-border-strong px-0.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted">
                      {dateline}
                    </div>
                  )}
                  <div className="flex flex-col gap-3 wide:flex-row wide:flex-wrap wide:items-start wide:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Masthead wordmark: high-optical-size Fraunces, the peeking-pup mark
                            grown into the face of the app (bled vertically so the row's height
                            doesn't inflate), a terracotta full stop. */}
                        <h1
                          className="flex items-center gap-1.5 whitespace-nowrap font-serif text-2xl font-semibold text-ink wide:text-[38px] wide:font-[620] wide:tracking-[-0.015em]"
                          style={{ fontVariationSettings: "'opsz' 70" }}
                        >
                          <TodoClawPeek
                            playful
                            className="h-7 w-7 wide:-my-3 wide:mr-0.5 wide:h-[62px] wide:w-[62px] wide:drop-shadow-sm"
                          />
                          TodoClaw
                          <span aria-hidden className="-ml-1.5 text-accent">
                            .
                          </span>
                        </h1>
                        <button
                          type="button"
                          onClick={handlePlanClick}
                          disabled={!planner.canGenerate}
                          title={
                            hasPlan
                              ? 'Replace the current plan with a freshly generated one'
                              : 'Generate a schedule-aware daily plan from your grid, recurring chores, and habits'
                          }
                          data-tour="plan"
                          className="whitespace-nowrap rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                          style={planPillStyle}
                        >
                          {planner.isPending ? (
                            <Thinking label="Thinking" />
                          ) : (
                            <>
                              <span aria-hidden className="text-[#e8c47a]">
                                ✦
                              </span>{' '}
                              {hasPlan ? 'Re-plan my day' : 'Plan My Day'}
                            </>
                          )}
                        </button>
                        {/* Grid-only view — a large pill matching Plan My Day's size, in the app's brand
                      green (the same fill as Add / Set / Save actions). Enters a fullscreen,
                      grid-alone mode (tagline / plan / reminders / input / toggle all hidden). */}
                        <button
                          type="button"
                          onClick={enterGridOnly}
                          title="Fill the screen with just the grid — hide everything else"
                          className="whitespace-nowrap rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                        >
                          <span aria-hidden>▦</span> Grid-only view
                        </button>
                      </div>
                      {!gridOnly && (
                        <>
                          {/* Terracotta claw swipe under the wordmark — aligned under the text
                              (the 62px mark + gap on its left), three strokes fading like a
                              scratch through paper. */}
                          <svg
                            className="ml-[68px] block"
                            width="118"
                            height="14"
                            viewBox="0 0 118 14"
                            aria-hidden="true"
                          >
                            <path
                              d="M2,4 Q58,15 114,3"
                              stroke="#c2693f"
                              strokeWidth="2.6"
                              strokeLinecap="round"
                              fill="none"
                              opacity="0.9"
                            />
                            <path
                              d="M8,8 Q56,17 104,7"
                              stroke="#c2693f"
                              strokeWidth="2"
                              strokeLinecap="round"
                              fill="none"
                              opacity="0.55"
                            />
                            <path
                              d="M16,12 Q54,18 88,11"
                              stroke="#c2693f"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              fill="none"
                              opacity="0.3"
                            />
                          </svg>
                          <p className="mt-1 font-serif text-[15px] italic text-muted">
                            Where your tasks learn to sit and stay.
                          </p>
                        </>
                      )}
                    </div>

                    {/* Quiet utility links — Settings/Done/Backups open header panels; Sign out ends the session.
                        data-tour="options": the tour's closing panel spotlights this REAL nav directly
                        (no look-alike copy — see DemoScene's header comment). */}
                    <nav
                      aria-label="Account"
                      data-tour="options"
                      className="flex items-center gap-4 text-xs text-muted"
                    >
                      {/* Chat comes first (where the inbox bell used to be) — it IS the inbox now,
                          so the unread count rides here. 🐾 is BabyClaw's identity mark app-wide. */}
                      <button
                        type="button"
                        onClick={openChatList}
                        title="BabyClaw — your chats, daily plan & recap"
                        data-tour="chat"
                        className="relative hover:text-ink"
                      >
                        <span aria-hidden>🐾</span> Chat
                        {unread > 0 && (
                          <span
                            aria-hidden
                            className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-puppy px-1 text-[10px] font-semibold leading-none text-white"
                          >
                            {unread > 9 ? '9+' : unread}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate('reminders')}
                        title="Daily habits"
                        data-tour="habits"
                        className="hover:text-ink"
                      >
                        <BoneIcon className="inline h-2.5 w-auto align-[-1px]" /> Daily habits
                      </button>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => navigate('admin')}
                          title="Owner admin panel"
                          className="hover:text-ink"
                        >
                          <span aria-hidden>❖</span> Admin
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowSettings(true)}
                        data-tour="settings"
                        className="hover:text-ink"
                      >
                        <span aria-hidden>⚙</span> Settings
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate('done')}
                        data-tour="done"
                        className="hover:text-ink"
                      >
                        <span aria-hidden>✓</span> Done
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmSignOut()}
                        className="hover:text-ink"
                      >
                        Sign out
                      </button>
                    </nav>
                  </div>
                  {/* Hairline rule closing the masthead before the plan/reminders/work region. */}
                  {!gridOnly && <div aria-hidden className="mt-3 h-px bg-ink/30" />}
                </header>
              )}

              {/* First-run setup guide — a dismissible checklist card (install as app → daily
          notifications → try Plan My Day) whose steps auto-detect completion. Renders only until
          dismissed or every step is done; a fully-set-up user never sees it. Above PlanBox so a
          plan generated from its last step appears directly beneath it. */}
              {!gridOnly && (
                <ErrorBoundary>
                  <SetupGuide
                    planReady={Boolean(planner.displayPlan)}
                    planPending={planner.isPending}
                    canPlan={planner.canGenerate}
                    onPlan={planner.generate}
                    onOpenNotificationSettings={() => {
                      setSettingsSection('notifications')
                      setShowSettings(true)
                    }}
                    onStartTour={() => {
                      // Close any open mobile quadrant-focus list so the shell is back at the
                      // overview when the tour's example-day overlay closes over it. Matches the
                      // Settings-replay path.
                      quadrantFocus.clear()
                      setTour('demo')
                    }}
                    onShowAddTask={isMobile ? () => setShowAdd(true) : () => setTour('add-task')}
                  />
                </ErrorBoundary>
              )}

              {/* The example-day scene the tour spotlights. Mounted for the guide-launched tour
                  AND the empty-state "See an example" peek — both play the same demo script. */}
              {(tour === 'demo' || tour === 'demo-solo') && (
                <ErrorBoundary>
                  <DemoScene onReady={() => setDemoReady(true)} />
                </ErrorBoundary>
              )}

              {/* The spotlight tour — an overlay pointing at the demo scene (or the Task Manager),
                  so it mounts beside the content it spotlights.
                    'demo'      → the first-run tour; ANY close (finish, skip, Esc) latches the
                                  checklist step (someone who skipped shouldn't be nagged by an
                                  eternal unchecked box);
                    'demo-solo' → the same tour as a peek — closes back to home, latches nothing;
                    'add-task'  → the single-step Task Manager spotlight — latches nothing. */}
              {tour && (tour === 'add-task' || demoReady) && (
                <ErrorBoundary>
                  <FeatureTour
                    // Remount per tour type (fresh step index + once-resolved anchors).
                    key={tour}
                    steps={
                      tour === 'demo' || tour === 'demo-solo'
                        ? demoTour(isMobile)
                        : ADD_TASK_SPOTLIGHT
                    }
                    // The peek's escape hatch just closes ("Close"); the first-run tour uses the
                    // default "Skip tour".
                    skipLabel={tour === 'demo-solo' ? 'Close' : undefined}
                    finishLabel={tour === 'demo' || tour === 'demo-solo' ? 'Done' : undefined}
                    onClose={() => {
                      setDemoReady(false)
                      if (tour === 'demo') {
                        // Latch locally (instant, this context) AND mirror to the account so the
                        // checkmark survives a browser↔installed-app storage-partition switch (#3).
                        markTourDone()
                        markTourSeen()
                      }
                      setTour(null)
                    }}
                  />
                </ErrorBoundary>
              )}

              {/* Plan My Day — a persistent inline card (not a modal) at the top, under the
          header/masthead. It hydrates from today's daily_state.plan, survives reloads, and
          auto-clears at local midnight. The card only renders once there's a plan, a generation in
          flight, or an error/paused notice. DESKTOP triggers from the header pill; MOBILE gets its
          own persistent pill here (its top bar is decorative) — the pill stays put and flips to
          "Re-plan my day" while a plan is on screen, rather than being hidden behind the card. */}
              {!gridOnly && (
                <>
                  {isMobile && (
                    <div className="mb-3 flex justify-center">
                      <button
                        type="button"
                        onClick={() => void handlePlanClick()}
                        disabled={!planner.canGenerate}
                        title={
                          hasPlan
                            ? 'Replace the current plan with a freshly generated one'
                            : 'Generate a schedule-aware daily plan from your grid, recurring chores, and habits'
                        }
                        data-tour="plan"
                        className="whitespace-nowrap rounded-full bg-ink px-6 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                        style={planPillStyle}
                      >
                        {planner.isPending ? (
                          <Thinking label="Thinking" />
                        ) : (
                          <>
                            <span aria-hidden className="text-[#e8c47a]">
                              ✦
                            </span>{' '}
                            {hasPlan ? 'Re-plan my day' : 'Plan My Day'}
                          </>
                        )}
                      </button>
                    </div>
                  )}
                  {/* Hidden while the demo tour plays — DemoScene's own demo-plan block stands in
                      for this, and mounting both would show two plans/boards stacked. */}
                  {!demoActive &&
                    (planner.displayPlan ||
                      planner.isPending ||
                      planner.isError ||
                      planner.paused) && (
                      <div className="mb-3">
                        <ErrorBoundary>
                          <PlanBox
                            mobile={isMobile}
                            plan={planner.displayPlan}
                            paused={planner.paused}
                            isPending={planner.isPending}
                            isError={planner.isError}
                            onRetry={planner.generate}
                            onDismiss={planner.clear}
                            rockDone={planner.rockDone}
                          />
                        </ErrorBoundary>
                      </div>
                    )}
                </>
              )}

              {/* Daily reminders — the minified inline form: a compact row of active reminder names near
          the top of the work area. Each name opens that reminder's detail card; the full popup is
          the gear-area Reminders button. The old full-width habits strip is gone (B2 owns the grid
          expansion into the freed space). Hidden in grid-only mode, and while the demo tour plays
          (DemoScene mounts the real RemindersInline itself, under its own demo-habits anchor). */}
              {!gridOnly && !demoActive && (
                <ErrorBoundary>
                  <RemindersInline />
                </ErrorBoundary>
              )}

              {/* Hidden while the demo tour plays — DemoScene mounts the real board itself, under
                  its own demo-board anchor; both at once would stack two boards. */}
              {!demoActive && (
                <ErrorBoundary>
                  <WorkArea
                    chat={chat}
                    onOpenChat={openChatConversation}
                    gridOnly={gridOnly}
                    onExitGridOnly={exitGridOnly}
                    quadrantFocus={quadrantFocus}
                    chatUnread={unread}
                    onSeeExample={() => setTour('demo-solo')}
                  />
                </ErrorBoundary>
              )}
            </>
          )}

          {/* Done: an overlay over the still-mounted home above (which is why 'done' is in the home
              condition) — a centered popup on desktop (DonePage), a bottom sheet on mobile
              (DoneSheet). Same `#/done` route either way (deep links + browser Back work); only the
              presentation differs. Back is the ✕ / scrim inside each (→ goBack) or the browser
              button. Daily reminders below is the same shape (a desktop popup / mobile sheet). */}
          {route === 'done' && (
            <ErrorBoundary>{isMobile ? <DoneSheet /> : <DonePage />}</ErrorBoundary>
          )}

          {/* Daily habits: an overlay over the still-mounted home — a centered popup on desktop
              (RemindersPage), a bottom sheet on mobile (RemindersSheet). Same `#/reminders` route
              either way — deep links and the browser Back button behave identically, and clicking
              the scrim / swiping down / Back all close it. Only the presentation differs. */}
          {route === 'reminders' && (
            <ErrorBoundary>{isMobile ? <RemindersSheet /> : <RemindersPage />}</ErrorBoundary>
          )}

          {/* Owner-only Admin panel (belt-and-suspenders: gated on isOwner here AND inside the page;
              the real gate is the server-side OWNER_USER_ID check in the admin Edge Function). */}
          {route === 'admin' && isOwner && (
            <ErrorBoundary>
              <AdminPage />
            </ErrorBoundary>
          )}

          {/* Route-independent overlay: Settings sits over whatever route is active. Backups now
              lives inside Settings → Backups (no longer its own overlay). */}
          {showSettings && (
            <ErrorBoundary>
              <SettingsPanel
                initialSection={settingsSection}
                onClose={() => {
                  setShowSettings(false)
                  setSettingsSection(undefined)
                }}
                onReplayTour={() => {
                  // Replay the tour WITHOUT resetting the setup guide's other checkmarks
                  // (install/notifications). Land on home first so the demo scene mounts over it.
                  setShowSettings(false)
                  setSettingsSection(undefined)
                  quadrantFocus.clear()
                  navigate('home')
                  setTour('demo')
                }}
              />
            </ErrorBoundary>
          )}

          {/* Mobile chrome (Concept D): the ➕ add sheet, the "More" overflow sheet, and the toast.
              The thumb-zone bottom nav itself lives OUTSIDE this scroll region — it's an in-flow
              child of the flex column (below) so it always hugs the screen bottom. Hidden in
              grid-only mode (the fullscreen grid owns the screen). */}
          {isMobile && !gridOnly && (
            <>
              <MobileAddSheet
                open={showAdd}
                defaultQuadrant={quadrantFocus.focus}
                onAdded={(dest: QuadrantKey) => {
                  const c = QUADRANT_CENTER[dest]
                  showToast(`Added to ${quadrantMeta(c.x, c.y).label} ✓`)
                }}
                onOpenChat={openChatConversation}
                onClose={() => setShowAdd(false)}
              />
              <MoreSheet
                open={showMore}
                onGrid={enterGridOnly}
                onReminders={() => navigate('reminders')}
                onSettings={() => setShowSettings(true)}
                onAdmin={isOwner ? () => navigate('admin') : undefined}
                onSignOut={() => void confirmSignOut()}
                onClose={() => setShowMore(false)}
              />
            </>
          )}
        </div>
      </div>

      {/* The thumb-zone bottom nav — the flex column's last in-flow child (mobile only), so it
          always sits flush to the bottom of the screen. Hidden in grid-only mode. */}
      {isMobile && !gridOnly && (
        <MobileBottomNav
          route={route}
          unread={unread}
          onHome={() => {
            // "Home" from inside a focus list means the top level — the overview. On the home
            // route the focus entry is consumed cleanly (exit → history.back); from another route
            // we just drop the focus and navigate.
            if (route === 'home' && quadrantFocus.focus) {
              quadrantFocus.exit()
            } else {
              quadrantFocus.clear()
              navigate('home')
            }
          }}
          onAdd={() => setShowAdd(true)}
          onChat={openChatList}
          onDone={() => navigate('done')}
          onMore={() => setShowMore(true)}
        />
      )}

      {/* Chat — desktop push-drawer (shrinks the grid) + mobile covering bottom-sheet. Both are
          driven by the same `showChat` flag; only one is visible per breakpoint. */}
      <ChatRail
        chat={chat}
        open={chatOpen}
        onClose={closeChat}
        view={chatView}
        onViewChange={setChatView}
        raised={gridOnly}
      />
      {chatOpen && (
        <ErrorBoundary>
          <ChatPanel chat={chat} onClose={closeChat} view={chatView} onViewChange={setChatView} />
        </ErrorBoundary>
      )}
    </div>
  )
}

export default function App() {
  const { session, loading } = useSession()

  return (
    // ConfirmProvider hosts the single app-themed confirm dialog (useConfirm) for every surface
    // beneath it — replacing bare window.confirm() calls. It wraps the whole shell so any view
    // (signed-in or auth) can gate a destructive action through it. ToastProvider hosts the single
    // <Snackbar> + useToast, so the mobile "Added ✓" pill and every failed-write error notice share
    // one transient toast across all surfaces.
    <ConfirmProvider>
      <ToastProvider>
        {loading ? (
          <main className="mx-auto min-h-full max-w-3xl p-6 wide:min-h-screen">
            <p className="text-muted">Loading…</p>
          </main>
        ) : session ? (
          // AppShell owns the full-width layout (its own centered column + the chat push-drawer).
          <ErrorBoundary>
            <AppShell />
          </ErrorBoundary>
        ) : (
          // The mascot's front door (style mix, login pass): centered masthead wordmark — no
          // icon up here, the AuthMascot peeking over the card below is the star — with the claw
          // swipe and the sign-in tagline. AuthGate renders the card + mascot.
          <main className="mx-auto flex min-h-full max-w-3xl flex-col items-center p-6 pt-14 wide:min-h-screen">
            <h1
              className="font-serif text-[46px] font-[620] leading-none tracking-[-0.015em] text-ink"
              style={{ fontVariationSettings: "'opsz' 70" }}
            >
              TodoClaw
              <span aria-hidden className="text-accent">
                .
              </span>
            </h1>
            <svg className="mt-1.5" width="130" height="14" viewBox="0 0 118 14" aria-hidden="true">
              <path
                d="M2,4 Q58,15 114,3"
                stroke="#c2693f"
                strokeWidth="2.6"
                strokeLinecap="round"
                fill="none"
                opacity="0.9"
              />
              <path
                d="M8,8 Q56,17 104,7"
                stroke="#c2693f"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
                opacity="0.55"
              />
              <path
                d="M16,12 Q54,18 88,11"
                stroke="#c2693f"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
                opacity="0.3"
              />
            </svg>
            <p className="mt-2.5 font-serif text-[17px] italic text-muted">
              Sit. Stay. Prioritize.
            </p>
            <div className="mt-1 w-full">
              <AuthGate />
            </div>
          </main>
        )}
      </ToastProvider>
    </ConfirmProvider>
  )
}
