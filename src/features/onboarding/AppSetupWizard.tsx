import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BottomSheet } from '../../components/BottomSheet'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { useEnableNotifications } from '../notifications/use-enable-notifications'
import { SafariTroubleshooting } from '../notifications/NotificationSettings'
import type { InstallContext } from './use-setup-guide'
import {
  ChromeInstallBar,
  DockScene,
  IosShareSheet,
  IosShareToolbar,
  SafariFileMenu,
} from './InstallPanels'

// AppSetupWizard — the setup guide's "Set it up" walkthrough for ONE combined job: get Todoclaw
// installed AND its daily notifications on, in the order that actually works. On Apple platforms
// the installed app is effectively a SEPARATE app — its own sign-in (isolated storage, hence the
// re-login) and its own notification permission — so enabling in the browser tab first is a trap
// (on iPhone the tab can't enable at all; on macOS Safari the permission wouldn't follow to the
// Dock app). The wizard therefore sends Apple users into the installed app to finish — and the
// checklist auto-reappears there (fresh storage) with install already checked, handing them the
// notifications button at the right moment. Chromium shares the profile between tab and app, so
// it gets install (recommended) then notifications right here; 'unknown' (no install gesture)
// goes straight to notifications.
//
// Each page pairs its instruction rows with a drawn "screenshot" of the real browser UI
// (InstallPanels) so a non-technical user can find the button by shape, not by name.
// Presentation follows ConfirmDialog's split: a bottom sheet on phones, a centered card on desktop.

type WizardPage = 'install' | 'switch' | 'notifications'

function pagesFor(context: InstallContext, installed: boolean): WizardPage[] {
  if (installed || context === 'unknown') return ['notifications']
  if (context === 'chromium') return ['install', 'notifications']
  // ios + macos-safari: install, then switch INTO the app — notifications happen there.
  return ['install', 'switch']
}

const PAGE_TITLE: Record<WizardPage, Record<InstallContext, string>> = {
  install: {
    ios: 'Add Todoclaw to your Home Screen',
    'macos-safari': 'Add Todoclaw to your Dock',
    chromium: 'Install the Todoclaw app',
    unknown: 'Install the Todoclaw app',
  },
  switch: {
    ios: 'Open it from your Home Screen',
    'macos-safari': 'Open it from your Dock',
    chromium: 'Use the app from now on',
    unknown: 'Use the app from now on',
  },
  notifications: {
    ios: 'Turn on daily notifications',
    'macos-safari': 'Turn on daily notifications',
    chromium: 'Turn on daily notifications',
    unknown: 'Turn on daily notifications',
  },
}

function StepRow({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-card text-xs font-semibold text-muted"
      >
        {n}
      </span>
      <p className="min-w-0 flex-1 text-sm leading-snug text-ink">{children}</p>
    </li>
  )
}

/** A drawn-screenshot slot — bordered so it reads as "a picture of what you'll see". */
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center rounded-xl border border-border bg-bg px-3 pb-2 pt-3">
      {children}
    </div>
  )
}

function InstallPage({
  context,
  canPrompt,
  onInstallNow,
}: {
  context: InstallContext
  canPrompt: boolean
  onInstallNow: () => void
}) {
  if (context === 'ios') {
    return (
      <div className="flex flex-col gap-3">
        <ol className="flex flex-col gap-3">
          <StepRow n={1}>
            In Safari, tap the <span className="font-medium">Share</span> button — the square with
            the arrow:
          </StepRow>
          <Panel>
            <IosShareToolbar />
          </Panel>
          <StepRow n={2}>
            Scroll down the list and tap <span className="font-medium">“Add to Home Screen”</span>:
          </StepRow>
          <Panel>
            <IosShareSheet />
          </Panel>
          <StepRow n={3}>
            Tap <span className="font-medium">Add</span> (top right) — Todoclaw gets its own icon,
            like any app.
          </StepRow>
        </ol>
      </div>
    )
  }
  if (context === 'macos-safari') {
    return (
      <div className="flex flex-col gap-3">
        <ol className="flex flex-col gap-3">
          <StepRow n={1}>
            In Safari’s menu bar (very top of the screen), click{' '}
            <span className="font-medium">File</span>, then{' '}
            <span className="font-medium">“Add to Dock…”</span>:
          </StepRow>
          <Panel>
            <SafariFileMenu />
          </Panel>
          <StepRow n={2}>
            Click <span className="font-medium">Add</span> — Todoclaw lands in your Dock with its
            own icon.
          </StepRow>
        </ol>
      </div>
    )
  }
  // chromium (+ the never-shown unknown fallback)
  return (
    <div className="flex flex-col gap-3">
      {canPrompt && (
        <button
          type="button"
          onClick={onInstallNow}
          className="self-start rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Install now
        </button>
      )}
      {canPrompt && <p className="text-[12px] text-muted-light">…or do it by hand:</p>}
      <ol className="flex flex-col gap-3">
        <StepRow n={1}>
          Find the <span className="font-medium">install icon</span> at the right end of the address
          bar and click it:
        </StepRow>
        <Panel>
          <ChromeInstallBar />
        </Panel>
        <StepRow n={2}>
          Click <span className="font-medium">Install</span>. No icon? Open the browser’s ⋮ menu and
          look for <span className="font-medium">“Install Todoclaw”</span>.
        </StepRow>
      </ol>
    </div>
  )
}

function SwitchPage({
  context,
  notif,
  enabled,
  onEnabled,
}: {
  context: InstallContext
  notif: ReturnType<typeof useEnableNotifications>
  enabled: boolean
  onEnabled: () => void
}) {
  const place = context === 'ios' ? 'Home Screen' : 'Dock'
  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <DockScene />
      </Panel>
      <p className="text-sm leading-snug text-ink">
        From now on, open Todoclaw from your <span className="font-medium">{place}</span>. You’ll
        sign in once more the first time — then everything is there: your tasks, your daily plan,
        and <span className="font-medium">BabyClaw</span> ready to chat.
      </p>
      <p className="text-sm leading-snug text-muted">
        This checklist follows you too — finish turning on notifications{' '}
        <span className="font-medium text-ink">inside the app</span> (it will offer you the button).
      </p>
      {/* macOS Safari can technically push from a tab; offer the stay-in-browser escape hatch
          quietly. iOS cannot — no hatch there. */}
      {context === 'macos-safari' &&
        (enabled ? (
          <p className="text-sm text-primary">Notifications are on for this browser ✓</p>
        ) : (
          <p className="text-[12px] text-muted-light">
            Prefer to stay in this Safari tab?{' '}
            <button
              type="button"
              onClick={() => void notif.enable().then((ok) => ok && onEnabled())}
              disabled={notif.busy}
              className="underline hover:text-ink disabled:opacity-50"
            >
              {notif.busy ? 'Turning on…' : 'Turn notifications on here instead'}
            </button>
          </p>
        ))}
      {context === 'macos-safari' && notif.error && (
        <p className="text-[13px] text-danger">{notif.error}</p>
      )}
      {context === 'macos-safari' && notif.setupFailed && <SafariTroubleshooting />}
    </div>
  )
}

function NotificationsPage({
  notif,
  enabled,
  onEnabled,
}: {
  notif: ReturnType<typeof useEnableNotifications>
  enabled: boolean
  onEnabled: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-snug text-ink">
        Your plan each morning (8 AM), a recap each evening (9 PM) — and a heads-up when a task with
        a set time is coming due. Change any of it in Settings.
      </p>
      {enabled ? (
        <p className="text-sm font-medium text-primary">Notifications are on for this device ✓</p>
      ) : (
        <button
          type="button"
          onClick={() => void notif.enable().then((ok) => ok && onEnabled())}
          disabled={notif.busy}
          className="self-start rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          <span aria-hidden>🔔</span> {notif.busy ? 'Turning on…' : 'Turn on notifications'}
        </button>
      )}
      {notif.error && <p className="text-[13px] text-danger">{notif.error}</p>}
      {notif.setupFailed && <SafariTroubleshooting />}
    </div>
  )
}

export function AppSetupWizard({
  context,
  installed,
  canPrompt,
  onInstallNow,
  onClose,
}: {
  context: InstallContext
  /** Already running as the installed app — skip straight to notifications. */
  installed: boolean
  /** Chromium handed us the deferred install prompt — offer the real one-click install. */
  canPrompt: boolean
  onInstallNow: () => void
  onClose: () => void
}) {
  const isMobile = useIsMobile()
  const notif = useEnableNotifications()
  const [page, setPage] = useState(0)
  // Flipped after a successful enable() in THIS wizard session — the checklist's auto-detect
  // re-renders behind us, but the open wizard shows its own immediate confirmation.
  const [enabled, setEnabled] = useState(false)
  const pages = pagesFor(context, installed)
  const id = pages[Math.min(page, pages.length - 1)]!
  const last = page >= pages.length - 1
  const title = PAGE_TITLE[id][context]

  useEffect(() => {
    if (isMobile) return // BottomSheet owns Escape on the phone presentation
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isMobile, onClose])

  const body = (
    <div className="flex flex-col gap-3">
      {id === 'install' && (
        <InstallPage context={context} canPrompt={canPrompt} onInstallNow={onInstallNow} />
      )}
      {id === 'switch' && (
        <SwitchPage
          context={context}
          notif={notif}
          enabled={enabled}
          onEnabled={() => setEnabled(true)}
        />
      )}
      {id === 'notifications' && (
        <NotificationsPage notif={notif} enabled={enabled} onEnabled={() => setEnabled(true)} />
      )}

      <div className="mt-1 flex items-center gap-2">
        {pages.length > 1 && (
          <span aria-hidden className="flex items-center gap-1">
            {pages.map((p, i) => (
              <span
                key={p}
                className={
                  'h-1.5 w-1.5 rounded-full ' + (i === page ? 'bg-accent' : 'bg-border-strong')
                }
              />
            ))}
          </span>
        )}
        <span className="flex-1" />
        {page > 0 && (
          <button
            type="button"
            onClick={() => setPage((p) => p - 1)}
            className="rounded-full border border-border-strong px-4 py-1.5 text-[13px] font-medium text-ink hover:border-ink"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={() => (last ? onClose() : setPage((p) => p + 1))}
          className="rounded-full bg-primary px-4 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
        >
          {!last ? 'Next' : id === 'switch' ? 'Done — I’ll finish in the app' : 'Done'}
        </button>
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <BottomSheet open onClose={onClose} title={title}>
        {body}
      </BottomSheet>
    )
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl border border-border-strong bg-panel p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-serif text-lg font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close setup walkthrough"
            className="text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="mt-3">{body}</div>
      </div>
    </div>,
    document.body,
  )
}
