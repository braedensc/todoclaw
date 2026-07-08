import { BottomSheet } from '../../components/BottomSheet'
import { HabitsView } from './HabitsView'
import { goBack } from '../../lib/route'

// "Daily reminders" as a mobile bottom sheet — the < 720px PRESENTATION of the `#/reminders`
// route (desktop keeps RemindersPage). App leaves the home screen mounted underneath and slides
// this up over it, so the user stays oriented; the reminder list scrolls INSIDE the sheet.
// Still a real route: deep links work, and every dismissal (a swipe-down on the grab handle, a
// scrim tap, Escape, or the hardware Back button) routes through `goBack` — so they all pop the
// same history entry. No ✕ on mobile: the swipe/scrim/Back are the way out.
export function RemindersSheet() {
  return (
    <BottomSheet
      open
      onClose={goBack}
      title="Daily reminders"
      className="flex max-h-[85dvh] flex-col"
    >
      {/* The scrollable body: HabitsView is untouched; this container owns the internal scroll. The
          sheet's grab handle + title (BottomSheet) name the surface and carry the dismiss gesture. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <HabitsView />
      </div>
    </BottomSheet>
  )
}
