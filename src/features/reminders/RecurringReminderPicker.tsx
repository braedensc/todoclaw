import { useState } from 'react'

// The "Remind me at" time-of-day chip row for a RECURRING task. Unlike ReminderPicker (which picks
// lead-time offsets before a single due instant), a recurring reminder is a FIXED-CADENCE ALARM: it
// fires at this wall-clock time on the task's cadence, every cycle, regardless of completion — so it
// picks a TIME, not an offset. Single-select (one recurring reminder per task): Off + presets +
// Custom (a native time input). Pure/presentational; the SchedulePanel owns the write.

const TIME_PRESETS: Array<{ label: string; value: string }> = [
  { label: '9 AM', value: '09:00' },
  { label: 'Noon', value: '12:00' },
  { label: '6 PM', value: '18:00' },
]

export function RecurringReminderPicker({
  value,
  onChange,
  idPrefix,
}: {
  /** Current wall-clock time ('HH:MM' or the wire 'HH:MM:SS') the alarm fires at, or null = off. */
  value: string | null
  /** Set the time ('HH:MM') or clear it (null). */
  onChange: (value: string | null) => void
  /** Namespaces the testid when several pickers mount (grid / list). */
  idPrefix?: string
}) {
  const current = value ? value.slice(0, 5) : ''
  const isPreset = TIME_PRESETS.some((p) => p.value === current)
  const [customOpen, setCustomOpen] = useState(!isPreset && current !== '')
  const showCustom = customOpen || (!isPreset && current !== '')
  const off = current === ''

  const chipBase = 'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors '
  const chipOn = 'border-primary bg-primary text-white'
  const chipOff = 'border-border-strong bg-card text-muted hover:text-ink'

  return (
    <div
      role="group"
      aria-label="Remind me at"
      className="flex flex-wrap items-center gap-1.5"
      data-testid={idPrefix ? `recurring-reminder-${idPrefix}` : 'recurring-reminder'}
    >
      <button
        type="button"
        aria-pressed={off}
        onClick={() => {
          setCustomOpen(false)
          onChange(null)
        }}
        className={chipBase + (off ? chipOn : chipOff)}
      >
        Off
      </button>
      {TIME_PRESETS.map((p) => {
        const on = !showCustom && p.value === current
        return (
          <button
            key={p.label}
            type="button"
            aria-pressed={on}
            onClick={() => {
              setCustomOpen(false)
              onChange(p.value)
            }}
            className={chipBase + (on ? chipOn : chipOff)}
          >
            {p.label}
          </button>
        )
      })}
      <button
        type="button"
        aria-pressed={showCustom}
        onClick={() => setCustomOpen(true)}
        className={chipBase + (showCustom ? chipOn : chipOff)}
      >
        Custom…
      </button>
      {showCustom && (
        <input
          type="time"
          aria-label="Reminder time"
          value={current}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          className="rounded border border-border-strong bg-card px-2 py-1 text-xs"
        />
      )}
    </div>
  )
}
