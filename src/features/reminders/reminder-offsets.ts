// The preset "remind me N before" offsets, in minutes before the due instant. Shared by the
// per-task ReminderPicker and the Notifications-tab default selector so the two never drift.
// `null` everywhere in the reminder UI means "no reminder" (Off); a number is minutes-before.
// Custom offsets are a v1 non-goal (the table stores an arbitrary int; presets cover the cases).

export interface ReminderOffset {
  minutes: number
  label: string
}

export const REMINDER_OFFSETS: readonly ReminderOffset[] = [
  { minutes: 0, label: 'At time' },
  { minutes: 10, label: '10 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 1440, label: '1 day' },
]

/** The built-in default offset (Braeden's call: 1 hour before) when the user hasn't set one. */
export const REMINDER_DEFAULT_MINUTES = 60

/**
 * The user's effective add-flow default, resolving the config's three-state field: `undefined`
 * (never set) → the built-in 1-hour default; `null` → off (no auto reminder); a number → that
 * offset. Mirrors settings-form's configToDraft mapping so the picker and the selector agree.
 */
export function effectiveReminderDefault(
  reminderDefaultMinutes: number | null | undefined,
): number | null {
  return reminderDefaultMinutes === undefined ? REMINDER_DEFAULT_MINUTES : reminderDefaultMinutes
}

/** A compact chip label for an offset (or "Off"): "1 hour before" / "No reminder". */
export function reminderLabel(minutes: number | null): string {
  if (minutes === null) return 'No reminder'
  const preset = REMINDER_OFFSETS.find((o) => o.minutes === minutes)
  if (minutes === 0) return 'At due time'
  return `${preset?.label ?? `${minutes} min`} before`
}
