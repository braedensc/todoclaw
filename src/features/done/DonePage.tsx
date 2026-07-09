import { DoneView } from './DoneView'
import { goBack } from '../../lib/route'

// Done on DESKTOP — a centered modal popup over the still-mounted home screen (BackupsPanel /
// SettingsPanel pattern), NOT a page swap. It stays a real `#/done` route (App keeps home rendered
// behind it), so deep links + the browser Back button still work: the scrim click, the ✕ inside
// DoneView, and Back all route through `goBack`. Mobile keeps the DoneSheet bottom sheet. DoneView
// supplies the panel card (non-bare), its own "Done" heading, and the ✕ (via onClose) — the scrim
// only dims + centers, so the dialog is named off DoneView's region.
export function DonePage() {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Done"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[calc(3rem_+_env(safe-area-inset-top))]"
      onClick={goBack}
    >
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DoneView onClose={goBack} />
      </div>
    </div>
  )
}
