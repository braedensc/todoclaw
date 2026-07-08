import { BottomSheet } from '../../components/BottomSheet'
import { DoneView } from './DoneView'
import { goBack } from '../../lib/route'

// "Done" as a mobile bottom sheet — the < 720px PRESENTATION of the `#/done` route (desktop keeps
// DonePage). Mirrors RemindersSheet: App leaves the home screen mounted underneath and slides this
// up over it, so the user stays oriented; the history list scrolls INSIDE the sheet. Still a real
// route — deep links work, and every dismissal (a swipe-down on the grab handle, a scrim tap,
// Escape, or the hardware Back button) routes through `goBack`, popping the same history entry.
// No ✕ on mobile: DoneView is rendered without `onClose` (so its ✕ is omitted) and `bare` (the
// sheet supplies the surface). DoneView keeps its own "Done" heading, so the sheet is named with
// `ariaLabel` rather than a `title` — otherwise the heading would render twice.
export function DoneSheet() {
  return (
    <BottomSheet open onClose={goBack} ariaLabel="Done" className="flex max-h-[85dvh] flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <DoneView bare />
      </div>
    </BottomSheet>
  )
}
