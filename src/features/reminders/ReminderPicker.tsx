import { REMINDER_OFFSETS } from './reminder-offsets'

// The per-task "Remind me" chip row: Off + the preset offsets. Pure/presentational — MULTI-SELECT
// (2026-07-11): a task can hold several reminders at once (e.g. "1 day" AND "1 hour" before), so
// `values` is the set of selected offsets (minutes-before) and any number of chips can be pressed.
// Tapping a preset toggles just that one (onToggle); the "Off" chip clears them all (onClear) and
// reads pressed only when nothing is selected. Shown in a due editor only once a due TIME exists
// (a reminder has no instant to anchor without one).

export function ReminderPicker({
  values,
  onToggle,
  onClear,
  idPrefix,
}: {
  /** Currently-selected offsets in minutes-before (empty = no reminders). */
  values: readonly number[]
  /** Toggle one preset offset on/off. */
  onToggle: (minutes: number) => void
  /** Clear every reminder (the Off chip). */
  onClear: () => void
  /** Makes the group label unique when several pickers mount (add widget + row). */
  idPrefix?: string
}) {
  const none = values.length === 0
  const chipBase = 'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors '
  const chipOn = 'border-primary bg-primary text-white'
  const chipOff = 'border-border-strong bg-card text-muted hover:text-ink'

  return (
    <div
      role="group"
      aria-label="Remind me"
      className="flex flex-wrap gap-1.5"
      data-testid={idPrefix ? `reminder-picker-${idPrefix}` : 'reminder-picker'}
    >
      <button
        type="button"
        aria-pressed={none}
        onClick={onClear}
        className={chipBase + (none ? chipOn : chipOff)}
      >
        Off
      </button>
      {REMINDER_OFFSETS.map((o) => {
        const on = values.includes(o.minutes)
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.minutes)}
            className={chipBase + (on ? chipOn : chipOff)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
