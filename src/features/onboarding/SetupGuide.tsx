import { useState, type ReactNode } from 'react'
import { useSetupGuide, type InstallContext, type SetupStepKey } from './use-setup-guide'
import { AppSetupWizard } from './AppSetupWizard'
import { useEnableNotifications } from '../notifications/use-enable-notifications'
import { SafariTroubleshooting } from '../notifications/NotificationSettings'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { useConfirm } from '../../components/use-confirm'

// SetupGuide — the first-run "Get set up" card, rendered at the top of the home shell on both
// desktop and mobile. Its steps (2026-07-09, split-steps pass):
//   1. Take the guided tour (what the app IS).
//   2/3. Install the app AND turn on notifications — now TWO separate, separately-tracked steps.
//        They were one combined step, but installing (which on iPhone covers the screen and boots
//        you out to the Home Screen) left people thinking they'd finished when notifications still
//        waited. Split, each gets its own checkmark. Order is platform-adaptive (use-setup-guide):
//        Apple must install BEFORE notifications (iOS can't grant them in a tab); everyone else does
//        the non-disruptive notifications first and installs last.
//   4. Add a first task, then generate today's plan — button EVOLVES "Show me where" → "✦ Plan my day".
// Each step auto-checks itself (see use-setup-guide.ts). A quiet parchment card in the PlanBox idiom,
// not a modal: the install gesture happens outside the page, so the card must survive the user
// leaving and coming back in a different context.
//
// Open by DEFAULT everywhere now (2026-07-09) so first-run users can't miss it — on a phone it can
// still be folded to a one-line "🐾 Get set up · x/4 ▸" banner via Collapse, but it no longer starts
// that way. Dismissing an unfinished guide asks first (and says where to bring it back).

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

// The install step's wording per install gesture — the words on the actual buttons, never "PWA".
// ('unknown' has no install step, so its entries are never shown — kept only to satisfy the map.)
const INSTALL_STEP_TITLE: Record<InstallContext, string> = {
  ios: 'Add TodoClaw to your Home Screen',
  'macos-safari': 'Add TodoClaw to your Dock',
  chromium: 'Install the TodoClaw app',
  unknown: 'Install the TodoClaw app',
}
const INSTALL_STEP_HINT: Record<InstallContext, string> = {
  ios: 'Gives TodoClaw its own icon — and it’s how your iPhone lets it send you notifications (the next step). The guide shows every tap.',
  'macos-safari':
    'Gives TodoClaw its own Dock icon and window, and lets its notifications reach you. The guide shows exactly what to click.',
  chromium:
    'Give TodoClaw its own window and taskbar/dock icon — it launches and behaves like a real app.',
  unknown: '',
}

// Dismiss ✕ — a 44px tap target (mobile touch guideline), used on both the full card and the
// collapsed banner. The glyph stays small; the padding makes the reachable area big.
const DISMISS_BTN =
  'flex h-11 w-11 items-center justify-center rounded text-base text-muted hover:text-ink'

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
  const confirm = useConfirm()
  // Open by default (both breakpoints); the phone can fold it back to the banner via Collapse.
  const [expanded, setExpanded] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  if (!guide.visible) return null

  const { install } = guide

  // Dismissing an UNFINISHED guide asks first (and reminds where to bring it back) — losing an
  // in-progress checklist to a mistap is worse than one extra tap. The finished "You’re all set!"
  // state closes straight away; there’s nothing left to lose.
  const handleDismiss = async (): Promise<void> => {
    if (guide.allDone) {
      guide.dismiss()
      return
    }
    const ok = await confirm({
      title: 'Remove the setup guide?',
      message:
        'You haven’t finished setting up yet. You can bring it back anytime from Settings → “Show the setup guide.”',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
    })
    if (ok) guide.dismiss()
  }

  const heading = guide.allDone ? 'You’re all set!' : 'Get set up'

  const renderStep = (key: SetupStepKey, index: number): ReactNode => {
    switch (key) {
      case 'tour':
        return (
          <Step key="tour" index={index} done={guide.done.tour} title="See how TodoClaw works">
            <StepHint>
              Watch a quick example day — a filled-out board, the morning plan, and BabyClaw’s
              check-ins in action.
            </StepHint>
            <StepButton onClick={onStartTour}>Take the tour</StepButton>
          </Step>
        )
      case 'install':
        return (
          <Step
            key="install"
            index={index}
            done={guide.done.install}
            title={INSTALL_STEP_TITLE[install.context]}
          >
            <StepHint>{INSTALL_STEP_HINT[install.context]}</StepHint>
            <StepButton onClick={() => setShowWizard(true)}>Show me how</StepButton>
          </Step>
        )
      case 'notifications':
        return (
          <Step
            key="notifications"
            index={index}
            done={guide.done.notifications}
            title="Turn on daily notifications"
          >
            {guide.canEnableNotificationsHere ? (
              <>
                <StepHint>
                  Your plan every morning, BabyClaw’s evening check-in (reply with what you did — he
                  marks it done), and a heads-up before timed tasks.
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
              // Apple, not yet installed: notifications can't be granted here — send them to the
              // install step (rendered just above this one on Apple) first.
              <StepHint>
                {install.context === 'ios'
                  ? 'Add TodoClaw to your Home Screen first (the step above) — iPhone only lets the installed app send notifications. Then turn them on inside it.'
                  : 'Add TodoClaw to your Dock first (the step above) — then turn notifications on inside the app so they reach you reliably.'}
              </StepHint>
            )}
          </Step>
        )
      case 'plan':
        return (
          <Step
            key="plan"
            index={index}
            done={guide.done.plan}
            title="Add a task, then let TodoClaw plan your day"
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
                  Nice — your first task is in. Now one tap turns your tasks, chores, and habits
                  into a realistic plan for today.
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
        )
    }
  }

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
          className="flex min-h-[44px] w-full items-center gap-2 pr-10 text-left"
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
          onClick={() => void handleDismiss()}
          aria-label="Remove setup guide"
          title="Remove this guide (you can bring it back from Settings)"
          className={'absolute right-2 top-1/2 -translate-y-1/2 ' + DISMISS_BTN}
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
        onClick={() => void handleDismiss()}
        aria-label="Remove setup guide"
        title="Remove this guide (you can bring it back from Settings)"
        className={'absolute right-1.5 top-1.5 ' + DISMISS_BTN}
      >
        ✕
      </button>

      <div className="flex items-baseline gap-2 pr-11">
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
      {/* The one-line pitch: what TodoClaw IS, before any step asks for anything. */}
      <p className="mt-0.5 text-[13px] leading-snug text-muted">
        {guide.allDone
          ? 'You know your way around, TodoClaw is installed, and your daily plan will find you. Go get it.'
          : `Welcome! TodoClaw is your to-do list on a map — tasks land by how urgent and important they are, so what to do next is always obvious. ${
              guide.stepCount === 4 ? 'Four' : 'Three'
            } quick steps:`}
      </p>

      <ol className="mt-3 flex flex-col gap-3">
        {guide.order.map((key, i) => renderStep(key, i + 1))}
      </ol>

      {guide.allDone && (
        <button
          type="button"
          onClick={() => guide.dismiss()}
          className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Finish setup
        </button>
      )}

      {showWizard && (
        <AppSetupWizard
          context={install.context}
          canPrompt={install.canPrompt}
          onInstallNow={install.promptInstall}
          onClose={() => setShowWizard(false)}
        />
      )}
    </section>
  )
}
