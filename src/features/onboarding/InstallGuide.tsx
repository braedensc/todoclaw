import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { useIsMobile } from '../../hooks/use-is-mobile'
import type { InstallContext } from './use-setup-guide'

// InstallGuide — the setup guide's "Show me how" walkthrough for installing Todoclaw as an app.
// "Install as an app" means nothing to a non-technical user; what they need is *which button to
// tap*, in order, with a picture of the button. Each platform gets 3–4 numbered steps, and the
// glyph chips are drawn to look like the real browser buttons (the iOS share square-and-arrow,
// Chrome's screen-with-arrow install icon) so they're findable by shape, not by name.
// Presentation follows ConfirmDialog's split: a bottom sheet on phones, a centered card on desktop.

const TITLES: Record<InstallContext, string> = {
  ios: 'Add Todoclaw to your Home Screen',
  'macos-safari': 'Add Todoclaw to your Dock',
  chromium: 'Install the Todoclaw app',
  unknown: 'Install the Todoclaw app',
}

// --- glyphs: hand-drawn lookalikes of the real browser buttons --------------------------------
function GlyphChip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-bg text-ink"
    >
      {children}
    </span>
  )
}

/** iOS Share: the rounded square with the arrow escaping out the top. */
function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 9.5H7A2 2 0 0 0 5 11.5v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
      <path d="M12 14.5V3.5M8.5 6.5 12 3l3.5 3.5" />
    </svg>
  )
}

/** iOS "Add to Home Screen": the square with a plus. */
function AddHomeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  )
}

/** Chromium's address-bar install icon: a little screen with a down arrow landing on it. */
function InstallGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 15V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M12 8v5M9.5 11 12 13.5 14.5 11M9 20h6" />
    </svg>
  )
}

// --- steps -------------------------------------------------------------------------------------
function StepRow({ n, glyph, children }: { n: number; glyph?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-card text-xs font-semibold text-muted"
      >
        {n}
      </span>
      {glyph}
      <p className="min-w-0 flex-1 text-sm leading-snug text-ink">{children}</p>
    </li>
  )
}

function Steps({ context }: { context: InstallContext }) {
  if (context === 'ios') {
    return (
      <ol className="flex flex-col gap-3">
        <StepRow n={1} glyph={<GlyphChip label="The Share button">{<ShareGlyph />}</GlyphChip>}>
          In Safari, tap the <span className="font-medium">Share</span> button — the square with an
          arrow, at the bottom of the screen.
        </StepRow>
        <StepRow n={2} glyph={<GlyphChip label="Add to Home Screen">{<AddHomeGlyph />}</GlyphChip>}>
          Scroll down the list and tap <span className="font-medium">“Add to Home Screen”</span>.
        </StepRow>
        <StepRow n={3}>
          Tap <span className="font-medium">Add</span> (top right). Todoclaw gets its own icon, like
          any app.
        </StepRow>
        <StepRow n={4}>
          Open it from your <span className="font-medium">Home Screen</span> from now on — you’ll
          sign in once more the first time.
        </StepRow>
      </ol>
    )
  }
  if (context === 'macos-safari') {
    return (
      <ol className="flex flex-col gap-3">
        <StepRow n={1}>
          In Safari’s menu bar (top of the screen), click <span className="font-medium">File</span>.
        </StepRow>
        <StepRow n={2}>
          Choose <span className="font-medium">“Add to Dock…”</span>, then click{' '}
          <span className="font-medium">Add</span>.
        </StepRow>
        <StepRow n={3}>
          From now on, open Todoclaw from your <span className="font-medium">Dock</span> — its own
          window, with steadier notifications.
        </StepRow>
      </ol>
    )
  }
  // chromium + the (never-shown) unknown fallback share the Chrome/Edge instructions.
  return (
    <ol className="flex flex-col gap-3">
      <StepRow n={1} glyph={<GlyphChip label="The install icon">{<InstallGlyph />}</GlyphChip>}>
        Look at the <span className="font-medium">right end of the address bar</span> for this
        install icon.
      </StepRow>
      <StepRow n={2}>
        Click it, then <span className="font-medium">Install</span>. No icon? Open the browser’s ⋮
        menu and look for <span className="font-medium">“Install Todoclaw”</span>.
      </StepRow>
      <StepRow n={3}>
        Todoclaw opens in its own window and joins your dock / taskbar like any app.
      </StepRow>
    </ol>
  )
}

// --- the modal ---------------------------------------------------------------------------------
export function InstallGuide({
  context,
  canPrompt,
  onInstallNow,
  onClose,
}: {
  context: InstallContext
  /** Chromium handed us the deferred install prompt — offer the real one-click install first. */
  canPrompt: boolean
  onInstallNow: () => void
  onClose: () => void
}) {
  const isMobile = useIsMobile()
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
      <p className="text-[13px] text-muted">
        Installed, Todoclaw works like a real app: its own icon and window, full screen, and it can
        send your daily notifications.
      </p>
      {canPrompt && (
        <button
          type="button"
          onClick={() => {
            onInstallNow()
            onClose()
          }}
          className="self-start rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Install now
        </button>
      )}
      {canPrompt && <p className="text-[12px] text-muted-light">…or do it by hand any time:</p>}
      <Steps context={context} />
    </div>
  )

  if (isMobile) {
    return (
      <BottomSheet open onClose={onClose} title={TITLES[context]}>
        {body}
      </BottomSheet>
    )
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={TITLES[context]}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border-strong bg-panel p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-serif text-lg font-semibold text-ink">{TITLES[context]}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close install guide"
            className="text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="mt-3">{body}</div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border-strong px-5 py-2 text-sm font-medium text-ink hover:border-ink"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
