import { HabitsView } from './HabitsView'
import { goBack } from '../../lib/route'

// "Daily reminders" as a full page (ADR-0027) — replaces the old RemindersModal overlay. Same body
// as before (the self-contained HabitsView: active rows + queued + add-a-reminder), just on a page
// instead of a centered modal. This wrapper owns only the surface + title + back control; HabitsView
// supplies the inner labelled `region "Daily reminders"` and all data. The ✕ routes through
// `goBack`, matching the browser Back button.
export function RemindersPage() {
  return (
    <div className="mx-auto max-w-lg">
      <section className="rounded-xl border border-border-strong bg-panel p-6 shadow-sm">
        <header className="mb-3 flex items-center justify-between">
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

        <HabitsView />
      </section>
    </div>
  )
}
