import { useId } from 'react'
import { useTheme } from '../../hooks/use-theme'
import type { ThemePreference } from '../../lib/theme'

// Appearance (TOD-142) — the device-local Light / Dark / System choice. It is NOT part of the
// settings draft: a click applies at once through useTheme().setPreference (localStorage, or the
// session only when storage throws), Cancel never reverts it, and Save never sends it. That is why
// SettingsPanel renders it above the TabBar and outside the schedule loading gate — it must work
// while the account row is loading or has failed.

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

export function AppearanceControl() {
  const { preference, setPreference } = useTheme()
  const name = useId()
  const labelId = `${name}-label`
  const hintId = `${name}-hint`
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div>
        <p id={labelId} className="font-serif text-base font-semibold text-ink">
          Appearance
        </p>
        <p id={hintId} className="text-xs text-muted">
          Applies instantly · this device only
        </p>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        className="flex rounded-full border border-border-strong bg-card p-0.5"
      >
        {OPTIONS.map((o) => {
          const on = o.value === preference
          return (
            <label
              key={o.value}
              className={
                'cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ' +
                (on ? 'bg-ink text-on-ink' : 'text-muted hover:text-ink')
              }
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={on}
                onChange={() => setPreference(o.value)}
                className="sr-only"
              />
              {o.label}
            </label>
          )
        })}
      </div>
    </div>
  )
}
