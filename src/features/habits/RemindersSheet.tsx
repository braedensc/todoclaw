import { BottomSheet } from '../../components/BottomSheet'
import { HabitsView } from './HabitsView'
import { goBack } from '../../lib/route'

// "Daily reminders" as a mobile bottom sheet — the < 720px PRESENTATION of the `#/reminders`
// route (desktop keeps RemindersPage). App leaves the home screen mounted underneath and slides
// this up over it, so the user stays oriented; the reminder list scrolls INSIDE the sheet.
// Still a real route: deep links work, and every dismissal (scrim tap, Escape, the ✕) routes
// through `goBack`, exactly like the page's ✕ — so the browser/hardware Back button and the
// in-sheet controls all pop the same history entry.
export function RemindersSheet() {
  return (
    <BottomSheet
      open
      onClose={goBack}
      ariaLabel="Daily reminders"
      className="flex max-h-[85dvh] flex-col"
    >
      {/* Header matches RemindersPage's (same accessible names) — only the surface changed. */}
      <header className="mb-2 flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-ink">Daily reminders</h2>
        <button
          type="button"
          onClick={goBack}
          aria-label="Close reminders"
          className="rounded text-lg text-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
        >
          ✕
        </button>
      </header>

      {/* The scrollable body: HabitsView is untouched; this container owns the internal scroll. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <HabitsView />
      </div>
    </BottomSheet>
  )
}
