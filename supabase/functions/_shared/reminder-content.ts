// reminder-content.ts — the deterministic push/inbox copy for a task reminder. Pure (no I/O,
// no clock): the dispatcher feeds it a due_task_reminders row. Deliberately NOT AI-generated —
// reminders must be free (no tokens), instant, and predictable.

export interface ReminderRow {
  task_text: string
  /** Postgres `time` wire format 'HH:MM:SS' — the user's wall-clock due time. */
  due_time: string
  offset_minutes: number
}

export interface ReminderContent {
  title: string
  body: string
}

/**
 * '15:00:00' → '3:00 PM'. The stored value already IS the user's wall clock (wall-clock due
 * doctrine), so this is pure formatting — no timezone math. Locale pinned to en-US so server
 * output is deterministic (the client formats its own copies host-locale).
 */
export function formatClockTime(hms: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(hms)
  if (!m) return hms
  let h = Number(m[1])
  const suffix = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m[2]} ${suffix}`
}

/** 60 → '1 hour', 90 → '1h 30m', 10 → '10 minutes', 1440 → '1 day'. */
export function formatOffset(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  if (minutes % 1440 === 0) {
    const d = minutes / 1440
    return `${d} day${d === 1 ? '' : 's'}`
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60
    return `${h} hour${h === 1 ? '' : 's'}`
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * The notification: "⏰ Dentist appointment" / "Due in 1 hour — 10:30 AM" (offset 0 → "Due
 * now — 10:30 AM"). The title carries the task so the OS banner reads at a glance.
 */
export function buildReminderContent(row: ReminderRow): ReminderContent {
  const clock = formatClockTime(row.due_time)
  const when = row.offset_minutes === 0 ? 'Due now' : `Due in ${formatOffset(row.offset_minutes)}`
  return {
    title: `⏰ ${row.task_text}`,
    body: `${when} — ${clock}`,
  }
}
