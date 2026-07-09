// Timezone-mismatch banner — keeps the app's ONE authoritative timezone honest.
//
// `user_schedule.timezone` drives every "today" boundary (daily reset, daysUntil, due chips) and
// — once per-task reminders land — reminder fire times. It is seeded from the browser at first
// sign-in and deliberately never auto-updated (useEnsureUserSchedule), so after a move or while
// traveling it silently disagrees with the device clock. The industry pattern for personal task
// apps (Todoist et al.) is wall-clock times plus an explicit, dismissible prompt on mismatch —
// never a silent switch (which would move every due chip behind the user's back) and never
// per-task timezone labels (noise that confuses more than it clarifies).
//
// "Keep" is remembered per zone-PAIR in localStorage, so declining once doesn't nag every visit,
// but a NEW mismatch (different city) prompts again. Switching writes the device zone through the
// normal schedule save; everything downstream (chips, reset, reminders) recomputes from the query
// invalidation.

import { useState } from 'react'
import { useSaveScheduleConfig, useUserSchedule } from './use-user-schedule'

const DISMISS_KEY = 'todoclaw.tz-mismatch.dismissed'

/** 'America/New_York' → 'New York'; 'Pacific/Auckland' → 'Auckland'. Friendly but unambiguous. */
function zoneLabel(zone: string): string {
  return (zone.split('/').pop() ?? zone).replaceAll('_', ' ')
}

/** The wall-clock reading in `zone` right now, e.g. "2:34 PM" — makes the gap concrete. */
function clockIn(zone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date())
  } catch {
    return ''
  }
}

export function TimezoneMismatchBanner({
  // Injectable for tests; the device's IANA zone otherwise.
  deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}: {
  deviceZone?: string
}) {
  const { data: schedule } = useUserSchedule()
  const save = useSaveScheduleConfig()
  // localStorage isn't reactive — bump local state after "Keep" so the banner unmounts now.
  const [, bump] = useState(0)

  const stored = schedule?.timezone
  if (!stored || stored === deviceZone) return null

  const pair = `${stored}→${deviceZone}`
  if (localStorage.getItem(DISMISS_KEY) === pair) return null

  const keep = () => {
    localStorage.setItem(DISMISS_KEY, pair)
    bump((n) => n + 1)
  }
  const switchZone = () => save.mutate({ config: schedule.config, timezone: deviceZone })

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border-strong bg-panel px-3.5 py-2.5 text-sm text-ink shadow-sm"
    >
      <span aria-hidden>🕐</span>
      <span className="min-w-0 flex-1 basis-52">
        Your device clock is on <strong>{zoneLabel(deviceZone)}</strong> time ({clockIn(deviceZone)}
        ), but Todoclaw is set to <strong>{zoneLabel(stored)}</strong> ({clockIn(stored)}). Due
        dates, reminders, and the daily reset follow the Todoclaw timezone.
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={switchZone}
          disabled={save.isPending}
          className="whitespace-nowrap rounded-full bg-primary px-3.5 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          Switch to {zoneLabel(deviceZone)}
        </button>
        <button
          type="button"
          onClick={keep}
          className="whitespace-nowrap rounded-full border border-border-strong bg-card px-3.5 py-2 text-xs font-medium text-muted hover:text-ink"
        >
          Keep {zoneLabel(stored)}
        </button>
      </span>
    </div>
  )
}
