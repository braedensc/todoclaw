import { DoneView } from './DoneView'
import { goBack } from '../../lib/route'

// Done as a full page (ADR-0027) — replaces the old DonePanel modal overlay. DoneView is unchanged:
// it already owns the labelled `region "Done"`, the history list, and the ✕ close control (rendered
// when `onClose` is passed). Here that close routes through `goBack`, so the ✕ and the browser Back
// button behave identically. The narrow `max-w-lg` keeps the list readable inside the wide desktop
// column; on mobile the surrounding shell adds bottom-nav clearance.
export function DonePage() {
  return (
    <div className="mx-auto max-w-lg">
      <DoneView onClose={goBack} />
    </div>
  )
}
