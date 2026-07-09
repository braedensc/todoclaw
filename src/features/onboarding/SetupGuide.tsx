import { useState, type ReactNode } from 'react'
import { useSetupGuide, type InstallContext } from './use-setup-guide'
import { AppSetupWizard } from './AppSetupWizard'
import { useEnableNotifications } from '../notifications/use-enable-notifications'
import { SafariTroubleshooting } from '../notifications/NotificationSettings'
import { useIsMobile } from '../../hooks/use-is-mobile'

// SetupGuide — the first-run "Get set up" card, rendered at the top of the home shell on both
// desktop and mobile. Three steps, as few and as plain as they can be (2026-07-08 workshop):
//   1. Take the guided tour (what the app IS).
//   2. Put Todoclaw in the Dock/Home Screen AND turn on daily notifications — ONE step, because
//      they are one job in the order that actually works: on Apple platforms the installed app
//      has its own sign-in and its own notification permission, so the wizard installs first,
//      moves the user into the app (where this card auto-reappears with install pre-checked),
//      and hands them the notifications button there. Chromium/unknown enable right here.
//   3. Add a first task, then generate today's plan — one step whose button EVOLVES from
//      "Show me where" to "✦ Plan my day" as the task appears.
// Each step auto-checks itself (see use-setup-guide.ts). Deliberately a quiet parchment card in
// the PlanBox idiom, not a modal: the install gesture happens outside the page, so the card has
// to survive the user leaving and coming back in a different context.
//
// On a PHONE the full card ate ~55% of the first screen and pushed the actual task matrix below
// the fold on every launch until dismissed (mobile audit §4.6) — so below 720px it starts as a
// one-line "🐾 Get set up · 1/3 ▸" banner that expands on tap (and can be collapsed again).
// Desktop always renders the full card; the collapse state is session-local by design.

function Step({
  index,
  done,
  title,
  children,
}: {
  index: number
  done: boolean
  title: string
  children?: ReactNode
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ' +
          (done ? 'bg-primary text-white' : 'border border-border-strong bg-card text-muted')
        }
      >
        {done ? '✓' : index}
      </span>
      <div className="min-w-0 flex-1">
        <p className={'text-sm font-medium ' + (done ? 'text-muted line-through' : 'text-ink')}>
          {title}
          {done && <span className="sr-only"> — done</span>}
        </p>
        {/* Finished steps collapse to their title so the card slims down as setup progresses. */}
        {!done && children}
      </div>
    </li>
  )
}

function StepHint({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 text-[13px] leading-snug text-muted">{children}</p>
}

function StepButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-2 rounded-full border border-border-strong bg-card px-4 py-1.5 text-[13px] font-medium text-ink hover:border-ink disabled:opacity-50"
    >
      {children}
    </button>
  )
}

// Step-2 wording per install gesture — the words on the actual buttons, never "install as a PWA".
const APP_STEP_TITLE: Record<InstallContext, string> = {
  ios: 'Put Todoclaw on your Home Screen & turn on notifications',
  'macos-safari': 'Put Todoclaw in your Dock & turn on notifications',
  chromium: 'Install the app & turn on notifications',
  unknown: 'Turn on daily notifications',
}
const APP_STEP_HINT: Record<InstallContext, string> = {
  ios: 'Two quick minutes: add Todoclaw to your Home Screen (iPhone needs that for notifications), then flip them on inside the app. The guide shows every tap.',
  'macos-safari':
    'Two quick steps: add Todoclaw to your Dock, then turn notifications on inside it. The guide shows exactly what to click.',
  chromium:
    'Give Todoclaw its own window and dock icon, then turn on the daily loop: your plan every morning, BabyClaw’s evening check-in, and timed-task reminders.',
  unknown:
    'Your plan every morning, BabyClaw’s evening check-in (tell him what you did — he marks it done), and timed-task reminders.',
}

export function SetupGuide({
  planReady,
  planPending,
  canPlan,
  onPlan,
  onOpenNotificationSettings,
  onStartTour,
  onShowAddTask,
}: {
  /** A plan exists for today (drives the auto-check of the last step). */
  planReady: boolean
  planPending: boolean
  canPlan: boolean
  onPlan: () => void
  /** Opens Settings scrolled to the Daily-notifications section (the "pick your times" link). */
  onOpenNotificationSettings: () => void
  /** Launches the FeatureTour walkthrough (App owns the overlay + the per-breakpoint script). */
  onStartTour: () => void
  /** "Show me where" — spotlight the Task Manager (desktop) / open the ➕ add sheet (mobile). */
  onShowAddTask: () => void
}) {
  const guide = useSetupGuide(planReady)
  const notif = useEnableNotifications()
  const isMobile = useIsMobile()
  // Mobile launches collapsed (initializer captures mount-time breakpoint; a mid-session
  // resize across 720px is a desktop-devtools case, not a phone one).
  const [expanded, setExpanded] = useState(() => !isMobile)
  const [showWizard, setShowWizard] = useState(false)
  if (!guide.visible) return null

  const { install } = guide
  // Installed (or no install gesture exists): the enable button lives right on the card — no
  // wizard detour. This is also the moment the wizard promised: the user just arrived in the
  // installed app and the card greets them with the one remaining button.
  const enableInPlace = install.done || install.context === 'unknown'
  let stepNo = 0
  const next = (): number => ++stepNo

  const heading = guide.allDone ? 'You’re all set!' : 'Get set up'

  // Collapsed banner (mobile only): one tappable line — title + progress + a chevron — with the
  // ✕ dismiss still available. Everything else waits behind the tap.
  if (isMobile && !expanded) {
    return (
      <section
        aria-label="Setup guide"
        className="relative mb-3 rounded-[14px] border border-border bg-panel px-4 py-1.5"
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="flex min-h-[44px] w-full items-center gap-2 pr-8 text-left"
        >
          <span aria-hidden>🐾</span>
          <span className="font-serif text-[15px] font-semibold text-ink">{heading}</span>
          <span className="text-xs text-muted-light">
            {guide.doneCount}/{guide.stepCount}
          </span>
          <span aria-hidden className="ml-auto text-muted">
            ▸
          </span>
        </button>
        <button
          type="button"
          onClick={guide.dismiss}
          aria-label="Dismiss setup guide"
          title="Hide this guide (you can bring it back from Settings)"
          className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-ink"
        >
          ✕
        </button>
      </section>
    )
  }

  return (
    <section
      aria-label="Setup guide"
      className="relative mb-3 rounded-[14px] border border-border bg-panel px-5 py-4"
    >
      <button
        type="button"
        onClick={guide.dismiss}
        aria-label="Dismiss setup guide"
        title="Hide this guide (you can bring it back from Settings)"
        className="absolute right-3 top-3 text-muted hover:text-ink"
      >
        ✕
      </button>

      <div className="flex items-baseline gap-2 pr-6">
        <h2 className="font-serif text-base font-semibold text-ink">
          <span aria-hidden className="mr-1.5">
            🐾
          </span>
          {heading}
        </h2>
        <span className="text-xs text-muted-light">
          {guide.doneCount}/{guide.stepCount}
        </span>
        {/* Fold the card back to the banner — phones only (desktop has no collapsed state). */}
        {isMobile && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-expanded
            className="ml-auto flex h-8 items-center gap-1 rounded px-2 text-xs text-muted hover:text-ink"
          >
            Collapse <span aria-hidden>▴</span>
          </button>
        )}
      </div>
      {/* The one-line pitch: what Todoclaw IS, before any step asks for anything. */}
      <p className="mt-0.5 text-[13px] leading-snug text-muted">
        {guide.allDone
          ? 'You know your way around, Todoclaw is installed, and your daily plan will find you. Go get it.'
          : 'Welcome! Todoclaw is your to-do list on a map — tasks land by how urgent and important they are, so what to do next is always obvious. Three quick steps:'}
      </p>

      <ol className="mt-3 flex flex-col gap-3">
        <Step index={next()} done={guide.tourDone} title="See how Todoclaw works">
          <StepHint>
            A 30-second walk through the essentials: the grid, BabyClaw (your AI helper), Plan My
            Day and its daily check-ins, and habits.
          </StepHint>
          <StepButton onClick={onStartTour}>Take the tour</StepButton>
        </Step>

        <Step index={next()} done={guide.notificationsDone} title={APP_STEP_TITLE[install.context]}>
          {enableInPlace ? (
            <>
              <StepHint>
                {install.done
                  ? 'You’re in the app ✓ — last thing: your plan arrives every morning by itself, and each evening BabyClaw checks in (reply with what you did — he marks it done).'
                  : APP_STEP_HINT.unknown}
              </StepHint>
              <StepButton onClick={() => void notif.enable()} disabled={notif.busy}>
                <span aria-hidden>🔔</span> {notif.busy ? 'Turning on…' : 'Turn on notifications'}
              </StepButton>
              {notif.error && <p className="mt-1.5 text-[13px] text-danger">{notif.error}</p>}
              {notif.setupFailed && (
                <div className="mt-2">
                  <SafariTroubleshooting />
                </div>
              )}
              <StepHint>
                Comes set to 8 AM and 9 PM, with task reminders an hour before — tune it all in{' '}
                <button
                  type="button"
                  onClick={onOpenNotificationSettings}
                  className="underline hover:text-ink"
                >
                  Settings
                </button>
                .
              </StepHint>
            </>
          ) : (
            <>
              <StepHint>{APP_STEP_HINT[install.context]}</StepHint>
              <StepButton onClick={() => setShowWizard(true)}>Set it up</StepButton>
            </>
          )}
        </Step>

        <Step
          index={next()}
          done={guide.planDone}
          title="Add a task, then let Todoclaw plan your day"
        >
          {!guide.taskAdded ? (
            <>
              <StepHint>
                {isMobile
                  ? 'Tap the ➕ at the bottom of the screen and describe it — or tell BabyClaw in Chat (“dentist Friday 2pm”) and he’ll add it for you.'
                  : 'Use the Task Manager box above the grid: tell BabyClaw in plain English (“dentist Friday 2pm”) and he’ll place it — or switch to Manual to do it yourself.'}
              </StepHint>
              <StepButton onClick={onShowAddTask}>
                {isMobile ? 'Add a task' : 'Show me where'}
              </StepButton>
            </>
          ) : (
            <>
              <StepHint>
                Nice — your first task is in. Now one tap turns your tasks, chores, and habits into
                a realistic plan for today.
              </StepHint>
              <StepButton onClick={onPlan} disabled={!canPlan || planPending}>
                <span aria-hidden className="text-[#b58a3d]">
                  ✦
                </span>{' '}
                {planPending ? 'Planning…' : 'Plan my day'}
              </StepButton>
            </>
          )}
        </Step>
      </ol>

      {guide.allDone && (
        <button
          type="button"
          onClick={guide.dismiss}
          className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Finish setup
        </button>
      )}

      {showWizard && (
        <AppSetupWizard
          context={install.context}
          installed={install.done}
          canPrompt={install.canPrompt}
          onInstallNow={install.promptInstall}
          onClose={() => setShowWizard(false)}
        />
      )}
    </section>
  )
}
