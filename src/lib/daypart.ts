// Time-of-day tint (style mix grab-bag): index.css keys the background corner-wash strengths
// off `html[data-daypart]` — cooler, green-leaning light in the morning, warm terracotta by
// evening, everything quieter at night. You feel the day passing without reading a clock.
// Pure function + a tiny installer (called once from main.tsx).
export type Daypart = 'morning' | 'day' | 'evening' | 'night'

export function daypartFor(hour: number): Daypart {
  if (hour < 5) return 'night'
  if (hour < 11) return 'morning'
  if (hour < 17) return 'day'
  if (hour < 21) return 'evening'
  return 'night'
}

/**
 * Stamp `<html data-daypart>` now and keep it fresh (10-minute ticks — the boundaries are
 * hours apart, this just catches long-lived tabs). Uses the browser-local hour deliberately:
 * the tint tracks the light outside the user's window, not their schedule timezone.
 */
export function installDaypart(): void {
  const apply = () => {
    document.documentElement.dataset.daypart = daypartFor(new Date().getHours())
  }
  apply()
  window.setInterval(apply, 10 * 60 * 1000)
}
