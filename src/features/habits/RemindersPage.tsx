import { HabitsView } from './HabitsView'
import { BoneIcon } from '../../components/BoneIcon'
import { goBack } from '../../lib/route'

// "Daily habits" as a DESKTOP popup (the `#/reminders` route's wide-screen presentation; mobile
// uses RemindersSheet). App leaves the home screen mounted underneath, so this floats over it as a
// centered modal — clicking the scrim (or the ✕, or the browser Back button) routes through
// `goBack` and closes it. No "Done"/save control: the setup surface auto-saves every add, so
// dismissing IS finishing.
export function RemindersPage() {
  return (
    <div
      role="dialog"
      aria-label="Daily habits"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[calc(3rem_+_env(safe-area-inset-top))]"
      onClick={goBack}
    >
      <section
        className="w-full max-w-2xl rounded-xl border border-border-strong bg-panel p-6 shadow-xl wide:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
            <BoneIcon className="h-3 w-auto text-puppy/70" />
            Daily habits
          </h2>
          <button
            type="button"
            onClick={goBack}
            aria-label="Close habits"
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
