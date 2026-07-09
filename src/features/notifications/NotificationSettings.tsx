import { useId } from 'react'
import type { SettingsDraft } from '../settings/settings-form'
import { REMINDER_OFFSETS } from '../reminders/reminder-offsets'
import { usePushSubscription, type ApplePlatform } from './use-push-subscription'

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

// The per-task reminder DEFAULT (ADR 2026-07-09): the offset pre-selected when you give a task a
// due time. A standing preference (not gated on the daily-digest toggle), though a reminder only
// actually delivers to a device that has notifications on.
function ReminderDefaultSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-muted">Default reminder for tasks with a time</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border-strong bg-card px-3 py-2 text-sm"
      >
        <option value="off">Off — no reminder unless I add one</option>
        {REMINDER_OFFSETS.map((o) => (
          <option key={o.minutes} value={String(o.minutes)}>
            {o.minutes === 0 ? 'At the due time' : `${o.label} before`}
          </option>
        ))}
      </select>
    </label>
  )
}

// The greeting name ("Good morning Alex! ☀️"). Optional; blank keeps the greeting generic.
function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-muted">Your name (in messages)</span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Alex"
        maxLength={40}
        className="rounded-lg border border-border-strong bg-card px-3 py-2 text-sm"
      />
    </label>
  )
}

// The "install as a web app" tip. On iOS this is required for push; on macOS it's optional but gives
// an app window and a sturdier push context. Renders nothing off Apple browsers.
function InstallTip({ platform }: { platform: ApplePlatform }) {
  if (platform === 'other') return null
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted">
      <span aria-hidden className="mr-1">
        💡
      </span>
      {platform === 'macos-safari' ? (
        <>
          Tip: in Safari, choose <span className="text-ink">File → Add to Dock</span> to install
          Todoclaw as an app — its own window, and steadier notifications.
        </>
      ) : (
        <>
          Tip: tap <span className="text-ink">Share → Add to Home Screen</span> to install Todoclaw.
          On iPhone &amp; iPad this is required to receive notifications.
        </>
      )}
    </div>
  )
}

// Shown after a subscribe attempt fails at Apple's push layer (the hollow-subscription case). These
// are the steps that actually recover it, in order of likelihood — see ADR-0031 / PR history.
// Exported for the setup guide's inline enable button, which can hit the same wall.
export function SafariTroubleshooting() {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted">
      <p className="text-ink">Safari couldn’t reach Apple’s push service. Things that fix it:</p>
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
        <li>Update macOS to the latest version.</li>
        <li>Quit and reopen Safari, or restart your Mac.</li>
        <li>System Settings → Notifications — make sure notifications are allowed.</li>
        <li>
          System Settings → Privacy &amp; Security → Location Services — turn on, enable Safari.
        </li>
        <li>
          Still stuck? Chrome, Edge, and Firefox use a different push service and work reliably.
        </li>
      </ul>
    </div>
  )
}

export function NotificationSettings({ draft, set }: { draft: SettingsDraft; set: SetField }) {
  const push = usePushSubscription()
  const enabled = draft.notificationsEnabled
  const showInstallTip = push.applePlatform !== 'other' && !push.installed

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
    <>
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
            // On iOS a browser tab has no PushManager at all — installing to the Home Screen is the
            // only way to get notifications, so lead with that instead of a flat "not supported".
            showInstallTip && push.applePlatform === 'ios' ? (
              <InstallTip platform="ios" />
            ) : (
              <p className="text-sm text-muted">This browser doesn’t support notifications.</p>
            )
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
              {push.setupFailed && <SafariTroubleshooting />}
              {showInstallTip && <InstallTip platform={push.applePlatform} />}

              {enabled && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <NameField
                      value={draft.notificationsName}
                      onChange={(v) => set('notificationsName', v)}
                    />
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

                  {/* Opt-in: suppress a daily push that would have nothing to say. */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-ink">
                      Only notify when there’s something to say
                      <span className="mt-0.5 block text-xs text-muted">
                        Skips the morning on an empty day and the evening when there’s no plan.
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={draft.quietWhenEmpty}
                      aria-label="Only notify when there’s something to say"
                      onClick={() => set('quietWhenEmpty', !draft.quietWhenEmpty)}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                        draft.quietWhenEmpty ? 'bg-accent' : 'bg-border-strong'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${
                          draft.quietWhenEmpty ? 'left-[1.375rem]' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </section>

      <section className="border-t border-border pt-4">
        <h3 className="font-serif text-base font-semibold text-ink">
          <span aria-hidden className="mr-1.5">
            ⏰
          </span>
          Task reminders
        </h3>
        <p className="mt-0.5 text-xs text-muted">
          Give a task a due time and Todoclaw can nudge you before it. This sets the default; you
          can change or remove it per task. Reminders reach any device where notifications are on.
        </p>
        <div className="mt-3">
          <ReminderDefaultSelect
            value={draft.reminderDefault}
            onChange={(v) => set('reminderDefault', v)}
          />
        </div>
      </section>
    </>
  )
}
