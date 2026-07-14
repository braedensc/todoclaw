// Pure display helpers for proactive (BabyClaw-initiated) messages/sessions. Kept free of Supabase
// so both the "Your chats" list and the chat header can reuse them without mocking the data layer.

export type ProactiveKind = 'plan' | 'recap' | 'reminder'

/** The short group/subtitle label for a proactive message kind. */
export function kindLabel(kind: ProactiveKind): string {
  return kind === 'plan' ? 'Morning plan' : kind === 'recap' ? 'Evening recap' : 'Reminder'
}

/**
 * A clear, day-stamped title for a daily check-in — e.g. "Monday morning plan" / "Monday evening
 * recap" — so the list and header make it obvious WHICH day each one is. Returns null for reminders
 * (they keep their own task-specific title) and for anything without a usable local date.
 *
 * `localDate` is a wall-clock 'YYYY-MM-DD' (the user's local calendar day). We parse it at LOCAL
 * midnight (`T00:00:00`) — never `new Date('YYYY-MM-DD')`, which is treated as UTC and lands a day
 * early west of UTC — then read its weekday.
 */
export function proactiveDayLabel(
  kind: ProactiveKind | string | null | undefined,
  localDate: string | null | undefined,
): string | null {
  if (!localDate || (kind !== 'plan' && kind !== 'recap')) return null
  const d = new Date(`${localDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long' })
  return `${weekday} ${kind === 'plan' ? 'morning plan' : 'evening recap'}`
}
