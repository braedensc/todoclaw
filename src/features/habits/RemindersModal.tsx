import { HabitsView } from './HabitsView'

// The FULL "Daily reminders" popup — opened from the gear-area nav button. It's the standard app
// modal shell (copied from SettingsPanel: z-50 over the mobile tab bar, click-outside + ✕ close)
// wrapping the self-contained HabitsView (all reminders: active rows + queued + add-a-reminder).
// HabitsView is hook-driven and owns its own data, so this is purely the surface + title.

export function RemindersModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Daily reminders"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-10"
      onClick={onClose}
    >
      <section
        className="w-full max-w-lg rounded-xl border border-border-strong bg-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-ink">Daily reminders</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reminders"
            className="text-muted hover:text-ink"
          >
            ✕
          </button>
        </header>

        <HabitsView />
      </section>
    </div>
  )
}
