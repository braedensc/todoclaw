// Caption for due-time editors, shown ONLY while the device clock disagrees with the stored
// timezone. The timezone doctrine's "quiet otherwise" rule: stamping a zone on every picker
// teaches users to worry about timezones; the caption appears exactly when that worry is
// warranted (the mismatch banner on home offers the actual fix).

import { useUserSchedule } from './use-user-schedule'
import { zoneLabel } from './zone-label'

export function DueTimezoneHint({
  // Injectable for tests; the device's IANA zone otherwise.
  deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}: {
  deviceZone?: string
}) {
  const stored = useUserSchedule().data?.timezone
  if (!stored || stored === deviceZone) return null
  return (
    <p className="text-[11px] leading-snug text-muted-light">
      Times are in {zoneLabel(stored)} time — your Todoclaw timezone.
    </p>
  )
}
