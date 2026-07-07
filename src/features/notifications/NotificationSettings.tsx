import { useId } from 'react'
import type { SettingsDraft } from '../settings/settings-form'
import { usePushSubscription } from './use-push-subscription'

// NotificationSettings — the opt-in section rendered inside the Settings panel (ADR-0031). The
// toggle drives the browser side (permission + subscription, via usePushSubscription) immediately,
// and writes `notificationsEnabled` + the hour prefs into the shared Settings draft so they persist
// on the panel's Save (the whole config is saved as one object — keeping these in the draft is what
// stops a normal save from wiping them). Off by default; a higher consent bar than in-app AI.

type SetField = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => void

const HOURS = Array.from({ length: 24 }, (_, h) => h)

function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve}:00 ${period}`
}

function HourSelect({
  label,
  value,
  onChange,
  allowEmpty,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  allowEmpty?: boolean
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border-strong bg-card px-3 py-2 text-sm"
      >
        {allowEmpty && <option value="">—</option>}
        {HOURS.map((h) => (
          <option key={h} value={String(h)}>
            {hourLabel(h)}
          </option>
        ))}
      </select>
    </label>
  )
}

export function NotificationSettings({ draft, set }: { draft: SettingsDraft; set: SetField }) {
  const push = usePushSubscription()
  const enabled = draft.notificationsEnabled

  async function handleToggle() {
    if (enabled) {
      set('notificationsEnabled', false)
      await push.unsubscribe()
      return
    }
    const ok = await push.subscribe()
    if (!ok) return
    // Sensible first-enable defaults (8 AM plan, 9 PM recap) if the user hasn't picked hours.
    if (!draft.morningHour) set('morningHour', '8')
    if (!draft.eveningHour) set('eveningHour', '21')
    set('notificationsEnabled', true)
  }

  return (
    <section className="border-t border-border pt-4">
      <h3 className="font-serif text-base font-semibold text-ink">
        <span aria-hidden className="mr-1.5">
          🔔
        </span>
        Daily notifications
      </h3>
      <p className="mt-0.5 text-xs text-muted">
        A morning plan and an evening recap, pushed to this device. Off by default.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {!push.supported ? (
          <p className="text-sm text-muted">This browser doesn’t support notifications.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink">
                {enabled ? 'Notifications are on for this device' : 'Enable notifications'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label="Enable daily notifications"
                disabled={push.busy}
                onClick={handleToggle}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                  enabled ? 'bg-accent' : 'bg-border-strong'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${
                    enabled ? 'left-[1.375rem]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>

            {push.error && <p className="text-sm text-danger">{push.error}</p>}

            {push.iosInstallHint && (
              <p className="text-xs text-muted">
                On iPhone or iPad, add Todoclaw to your Home Screen first (Share → Add to Home
                Screen), then enable notifications from the installed app.
              </p>
            )}

            {enabled && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <HourSelect
                  label="Morning plan"
                  value={draft.morningHour}
                  onChange={(v) => set('morningHour', v)}
                />
                <HourSelect
                  label="Evening recap"
                  value={draft.eveningHour}
                  onChange={(v) => set('eveningHour', v)}
                />
                <HourSelect
                  label="Quiet from"
                  value={draft.quietStartHour}
                  onChange={(v) => set('quietStartHour', v)}
                  allowEmpty
                />
                <HourSelect
                  label="Quiet until"
                  value={draft.quietEndHour}
                  onChange={(v) => set('quietEndHour', v)}
                  allowEmpty
                />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
