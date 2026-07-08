import { useEffect, useState } from 'react'
import { localDateInTZ } from '../lib/dates'

// The user's local calendar date ('YYYY-MM-DD'), kept LIVE across local midnight. Bare
// `localDateInTZ(tz)` in render is only recomputed when something else re-renders — an app left
// open overnight (a phone PWA especially) would keep showing yesterday's daily state until the
// first tap. This hook makes the flip happen on its own, which is what makes habits actually
// "reset each morning" on screen:
//   - a 60s tick recomputes the date (re-render bails out via setState equality until it flips),
//   - visibility/focus/pageshow recompute immediately, covering the real morning case — browsers
//     throttle or suspend background timers, so the moment the app is foregrounded matters most.
// DST-safe by construction: no midnight arithmetic, just "what date is it now in this zone".
export function useLocalToday(timeZone: string): string {
  const [today, setToday] = useState(() => localDateInTZ(timeZone))

  useEffect(() => {
    const update = () => setToday(localDateInTZ(timeZone))
    // The state initializer captured the FIRST render's zone; recompute when the zone changes.
    update()

    const id = setInterval(update, 60_000)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('pageshow', update)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('pageshow', update)
    }
  }, [timeZone])

  return today
}
