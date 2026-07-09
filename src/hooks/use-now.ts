import { useEffect, useState } from 'react'

/**
 * The current time, re-rendering every `intervalMs` (default 30s). One instance per VIEW
 * (GridSurface / ListView / MobileMatrix), passed down — not one per card — so a grid of N
 * cards ticks on a single interval. Drives the live countdown chips and the timed-overdue
 * flip; 30s keeps a "in 45m" chip at worst ~30s stale, which is invisible at minute
 * granularity.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
