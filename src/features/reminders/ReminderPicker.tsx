import { REMINDER_OFFSETS } from './reminder-offsets'

// The per-task "Remind me" chip row (workshop Fig 3): Off + the preset offsets. Pure/presentational
// — value is minutes-before (null = Off), onChange fires the parent's upsert/delete. Shown in a due
// editor only once a due TIME exists (a reminder has no instant to anchor without one).

const CHIPS: Array<{ minutes: number | null; label: string }> = [
  { minutes: null, label: 'Off' },
  ...REMINDER_OFFSETS,
]

export function ReminderPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: number | null
  onChange: (minutes: number | null) => void
  /** Makes the group label unique when several pickers mount (add widget + row). */
  idPrefix?: string
}) {
  return (
    <div
      role="group"
      aria-label="Remind me"
      className="flex flex-wrap gap-1.5"
      data-testid={idPrefix ? `reminder-picker-${idPrefix}` : 'reminder-picker'}
    >
      {CHIPS.map((c) => {
        const on = value === c.minutes
        return (
          <button
            key={c.label}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(c.minutes)}
            className={
              'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ' +
              (on
                ? 'border-primary bg-primary text-white'
                : 'border-border-strong bg-card text-muted hover:text-ink')
            }
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )
}
