import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { resetSetupGuide } from '../onboarding/setup-guide-store'
import { useMarkTourSeen } from '../onboarding/use-mark-tour-seen'
import { useUserSchedule, useSaveScheduleConfig } from '../schedule/use-user-schedule'
import {
  ASSISTANT_TONES,
  ASSISTANT_VERBOSITY,
  PLAN_NOTES_MAX,
  ASSISTANT_INSTRUCTIONS_MAX,
  COMMITMENTS_MAX,
} from '../../types/user-schedule'
import { EMPTY_DRAFT, configToDraft, draftToConfig, type SettingsDraft } from './settings-form'
import { AiPrivacyNote } from '../ai/AiPrivacyNote'
import { MemoryList } from '../ai/MemoryList'
import { NotificationSettings } from '../notifications/NotificationSettings'
import { BackupsPanel } from '../backups/BackupsPanel'

// Settings — an overlay editing `user_schedule.config`: the schedule the Plan My Day prompt reads
// (so it stops assuming your day), a bounded Plan My Day "preferences" note, and BabyClaw tuning.
// Every freeform field is length-capped here and re-validated on save; none of it can escape the
// fixed AI prompt scaffolds — it is layered on as preferences, never as instructions.
//
// Presentation splits on breakpoint: DESKTOP is the centered modal card (BackupsPanel pattern:
// z-50 over the mobile tab bar, click-outside + ✕ to close). MOBILE renders the same content in a
// slide-up BottomSheet — swipe-down / scrim / Escape dismiss, no ✕ (matching every mobile sheet).

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

// ---- Small labeled-input primitives (local; not components exported from this module) ---------

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  maxLength,
  min,
  max,
  step,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'number'
  maxLength?: number
  min?: number
  max?: number
  step?: number
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <input
        id={id}
        type={type}
        // Numeric fields (free hours etc.) accept decimals — the decimal soft keypad on phones.
        inputMode={type === 'number' ? 'decimal' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        min={min}
        max={max}
        step={step}
        className="rounded-lg border border-border-strong bg-card px-3 py-2 text-sm"
      />
    </label>
  )
}

function TextAreaField({
  label,
  hint,
  value,
  onChange,
  maxLength,
  placeholder,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  maxLength: number
  placeholder?: string
}) {
  const id = useId()
  // Counter + hint sit OUTSIDE the <label> so the field's accessible name is just `label`.
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-muted">
          {label}
        </label>
        <span className="text-xs text-muted-light">
          {value.length}/{maxLength}
        </span>
      </div>
      {hint && <span className="text-xs text-muted-light">{hint}</span>}
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        rows={4}
        placeholder={placeholder}
        className="rounded-lg border border-border-strong bg-card px-3 py-2 text-sm"
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: readonly string[]
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border-strong bg-card px-3 py-2 text-sm capitalize"
      >
        <option value="">Default</option>
        {options.map((o) => (
          <option key={o} value={o} className="capitalize">
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

// IANA timezone picker. The stored zone drives due chips, reminder fire times, and the daily
// reset (useTimeZone) — so it must be visible and editable here, not just silently seeded at
// sign-up. Options come from the runtime's own IANA table; the current value is prepended if the
// runtime's list lacks it (legacy aliases), so the select never renders blank.
function TimezoneField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId()
  const zones = useMemo(() => {
    const list =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
    return value && !list.includes(value) ? [value, ...list] : list
  }, [value])
  let clock = ''
  try {
    clock = new Intl.DateTimeFormat(undefined, {
      timeZone: value,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date())
  } catch {
    // Unknown zone string — the select still renders it; the clock preview just stays blank.
  }
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="text-muted">Timezone</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border-strong bg-card px-3 py-2 text-sm"
      >
        {zones.map((z) => (
          <option key={z} value={z}>
            {z.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-light">
        {clock && <>Right now: {clock} · </>}due dates, reminders, and the daily reset all follow
        this timezone.
      </span>
    </label>
  )
}

function Section({
  title,
  hint,
  icon,
  children,
}: {
  title: string
  hint?: string
  /** Optional decorative leading glyph (e.g. BabyClaw's 🐾 mark) — aria-hidden. */
  icon?: string
  children: ReactNode
}) {
  return (
    <section className="border-t border-border pt-4">
      <h3 className="font-serif text-base font-semibold text-ink">
        {icon && (
          <span aria-hidden className="mr-1.5">
            {icon}
          </span>
        )}
        {title}
      </h3>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  )
}

type SettingsTab = 'plan' | 'notifications' | 'ai' | 'backups'
const TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: 'plan', label: 'Plan My Day' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'ai', label: 'AI' },
  { id: 'backups', label: 'Backups' },
]

function TabBar({ tab, onTab }: { tab: SettingsTab; onTab: (t: SettingsTab) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      className="flex gap-1 border-b border-border"
    >
      {TABS.map((t) => {
        const on = t.id === tab
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onTab(t.id)}
            className={
              '-mb-px rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ' +
              (on ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink')
            }
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export function SettingsPanel({
  onClose,
  initialSection,
  onReplayTour,
}: {
  onClose: () => void
  /** Open scrolled to a section — the setup guide deep-links to 'notifications'. */
  initialSection?: 'notifications'
  /**
   * Re-run the two-act tour (example day + walkthrough) WITHOUT resetting the setup guide's
   * other checkmarks — the lightweight replay next to the full "Show the setup guide" reset.
   */
  onReplayTour?: () => void
}) {
  const scheduleQuery = useUserSchedule()
  const save = useSaveScheduleConfig()
  const { clearSeen: clearTourSeen } = useMarkTourSeen()

  // Three tabs (2026-07-09): Plan My Day / Notifications / AI. The setup guide's "turn on
  // notifications" deep-link (initialSection) picks the starting tab; Save persists the whole
  // draft regardless of which tab is showing, so tabs are pure views over one form.
  const [tab, setTab] = useState<SettingsTab>(
    initialSection === 'notifications' ? 'notifications' : 'plan',
  )

  const [draft, setDraft] = useState<SettingsDraft>(EMPTY_DRAFT)
  // Timezone is its own column (not part of the config jsonb draft): seeded from the browser at
  // first sign-in, edited only here. Initialize to the browser zone so a pre-seed render (row
  // still null) never shows a blank select; the hydrate below overwrites it with the stored zone.
  const [timezone, setTimezone] = useState(browserZone)
  const [hydrated, setHydrated] = useState(false)

  // Hydrate the form the first time the row loads, then let the user edit freely. Done as a
  // render-time state adjustment (React's sanctioned "derive state from props" pattern) rather
  // than an effect — it runs exactly once (hydrated latches true) and a later query refetch can't
  // clobber in-progress edits.
  if (!hydrated && scheduleQuery.data) {
    setHydrated(true)
    setDraft(configToDraft(scheduleQuery.data.config))
    setTimezone(scheduleQuery.data.timezone)
  }

  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const addCommitment = () =>
    setDraft((d) => ({ ...d, commitments: [...d.commitments, { label: '', when: '' }] }))
  const removeCommitment = (i: number) =>
    setDraft((d) => ({ ...d, commitments: d.commitments.filter((_, j) => j !== i) }))
  const updateCommitment = (i: number, key: 'label' | 'when', value: string) =>
    setDraft((d) => ({
      ...d,
      commitments: d.commitments.map((c, j) => (j === i ? { ...c, [key]: value } : c)),
    }))

  function handleSave() {
    save.mutate({ config: draftToConfig(draft), timezone }, { onSuccess: onClose })
  }

  const isMobile = useIsMobile()

  // The description + the loading gate / form + footer — identical on both surfaces. Only the
  // chrome around it differs (centered card + ✕ header on desktop; slide-up sheet on mobile).
  const content = (
    <>
      {scheduleQuery.isLoading ? (
        <p className="py-6 text-sm text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          <TabBar tab={tab} onTab={setTab} />

          {tab === 'plan' && (
            <>
              <Section
                title="Where you are"
                hint="Location feeds the weather line in your daily plan; the timezone anchors every time in the app."
              >
                <TextField
                  label="Location"
                  value={draft.location}
                  onChange={(v) => set('location', v)}
                  placeholder="e.g. Portland, OR"
                  maxLength={120}
                />
                <TimezoneField value={timezone} onChange={setTimezone} />
              </Section>

              <Section
                title="Weekday"
                hint="Times can be a point or a range (e.g. 9:30 or 12:00–1:00pm). Free-time hours drive how much the plan packs in."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextField
                    label="Wake time"
                    value={draft.wakeTime}
                    onChange={(v) => set('wakeTime', v)}
                    placeholder="7:30–8:00am"
                    maxLength={40}
                  />
                  <TextField
                    label="Bedtime"
                    value={draft.bedtime}
                    onChange={(v) => set('bedtime', v)}
                    placeholder="10:30–11:30pm"
                    maxLength={40}
                  />
                  <TextField
                    label="Work start"
                    value={draft.workStart}
                    onChange={(v) => set('workStart', v)}
                    placeholder="9:30"
                    maxLength={40}
                  />
                  <TextField
                    label="Work end"
                    value={draft.workEnd}
                    onChange={(v) => set('workEnd', v)}
                    placeholder="17:00"
                    maxLength={40}
                  />
                  <TextField
                    label="Lunch start"
                    value={draft.lunchStart}
                    onChange={(v) => set('lunchStart', v)}
                    placeholder="12:00"
                    maxLength={40}
                  />
                  <TextField
                    label="Lunch end"
                    value={draft.lunchEnd}
                    onChange={(v) => set('lunchEnd', v)}
                    placeholder="1:00pm"
                    maxLength={40}
                  />
                  <TextField
                    label="Free hours (weekday)"
                    value={draft.weekdayFreeHours}
                    onChange={(v) => set('weekdayFreeHours', v)}
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    placeholder="4.5"
                  />
                </div>
              </Section>

              <Section title="Weekend">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextField
                    label="Saturday free hours"
                    value={draft.saturdayFreeHours}
                    onChange={(v) => set('saturdayFreeHours', v)}
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    placeholder="9"
                  />
                  <TextField
                    label="Sunday free hours"
                    value={draft.sundayFreeHours}
                    onChange={(v) => set('sundayFreeHours', v)}
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    placeholder="7"
                  />
                </div>
                <TextField
                  label="Saturday notes"
                  value={draft.saturdayNotes}
                  onChange={(v) => set('saturdayNotes', v)}
                  placeholder="Mostly free — good for bigger tasks."
                  maxLength={280}
                />
                <TextField
                  label="Sunday notes"
                  value={draft.sundayNotes}
                  onChange={(v) => set('sundayNotes', v)}
                  placeholder="Slower start, free most of the day."
                  maxLength={280}
                />
              </Section>

              <Section
                title="Recurring commitments"
                hint="Standing obligations — gym, school pickup, a weekly meeting. Plan My Day treats these as already on the calendar: it plans around them and never suggests them as tasks."
              >
                {draft.commitments.length === 0 && (
                  <p className="text-xs text-muted-light">
                    None yet. Add anything that regularly claims your time.
                  </p>
                )}
                {draft.commitments.map((c, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                  >
                    <TextField
                      label="What"
                      value={c.label}
                      onChange={(v) => updateCommitment(i, 'label', v)}
                      placeholder="Gym"
                      maxLength={120}
                    />
                    <TextField
                      label="When (optional)"
                      value={c.when}
                      onChange={(v) => updateCommitment(i, 'when', v)}
                      placeholder="Tue/Thu 6pm"
                      maxLength={120}
                    />
                    <button
                      type="button"
                      onClick={() => removeCommitment(i)}
                      aria-label={`Remove commitment ${i + 1}`}
                      className="rounded-lg border border-border-strong px-3 py-2 text-sm text-muted hover:text-accent"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {draft.commitments.length < COMMITMENTS_MAX && (
                  <button
                    type="button"
                    onClick={addCommitment}
                    className="self-start rounded-full border border-border-strong px-4 py-1.5 text-sm font-medium text-muted hover:text-ink"
                  >
                    + Add commitment
                  </button>
                )}
              </Section>

              <Section title="Plan My Day preferences">
                <TextAreaField
                  label="Preferences"
                  hint="Free-text preferences for how you like your day planned (e.g. “front-load deep work before lunch; keep evenings light”). Treated as preferences, not commands — it can't change the plan's format or scope."
                  value={draft.planNotes}
                  onChange={(v) => set('planNotes', v)}
                  maxLength={PLAN_NOTES_MAX}
                  placeholder="Front-load deep work in the morning; keep evenings for admin only."
                />
              </Section>
            </>
          )}

          {tab === 'ai' && (
            <>
              <Section title="BabyClaw assistant" icon="🐾">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Tone"
                    value={draft.babyclawTone}
                    onChange={(v) => set('babyclawTone', v as SettingsDraft['babyclawTone'])}
                    options={ASSISTANT_TONES}
                  />
                  <SelectField
                    label="Verbosity"
                    value={draft.babyclawVerbosity}
                    onChange={(v) =>
                      set('babyclawVerbosity', v as SettingsDraft['babyclawVerbosity'])
                    }
                    options={ASSISTANT_VERBOSITY}
                  />
                </div>
                <TextAreaField
                  label="Custom instructions"
                  hint="Standing preferences for the assistant (e.g. “call me by my first name; keep replies short”). Layered on its fixed persona — it can't override the assistant's scope or safety rules."
                  value={draft.babyclawInstructions}
                  onChange={(v) => set('babyclawInstructions', v)}
                  maxLength={ASSISTANT_INSTRUCTIONS_MAX}
                  placeholder="Keep replies concise. Ask before creating tasks without a due date."
                />
              </Section>

              <Section title="What BabyClaw remembers" icon="🧠">
                <MemoryList
                  memoryEnabled={draft.babyclawMemoryEnabled}
                  onToggleMemory={(v) => set('babyclawMemoryEnabled', v)}
                />
              </Section>

              <Section
                title="AI &amp; privacy"
                hint="AI is optional — the planner works fully without it."
              >
                <AiPrivacyNote />
              </Section>
            </>
          )}

          {tab === 'notifications' && <NotificationSettings draft={draft} set={set} />}

          {/* Backups is live data with its own Create/Restore actions (not part of the settings
              draft) — the shared Save/Cancel footer below still applies to the other tabs' form. */}
          {tab === 'backups' && <BackupsPanel embedded />}

          {save.isError && (
            <p className="text-sm text-accent">Couldn't save your settings — please try again.</p>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {/* Watch the tour again (example day + walkthrough) without touching the guide. */}
              {onReplayTour && (
                <button
                  type="button"
                  onClick={onReplayTour}
                  className="text-xs text-muted underline hover:text-ink"
                >
                  Replay the tour
                </button>
              )}
              {/* Re-surface the first-run setup guide on this device (features/onboarding). */}
              <button
                type="button"
                onClick={() => {
                  // Clear BOTH halves of the tour checkmark (localStorage + account mirror) so the
                  // guide fully resets and the tour can be re-taken (#3).
                  resetSetupGuide()
                  clearTourSeen()
                  onClose()
                }}
                className="text-xs text-muted underline hover:text-ink"
              >
                Show the setup guide
              </button>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-4 py-2 text-sm font-medium text-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={save.isPending}
                className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {save.isPending ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  // Mobile: a slide-up sheet (swipe/scrim/Escape to dismiss, no ✕). The sheet supplies the
  // "Settings" title heading; the body scrolls inside it.
  if (isMobile) {
    return (
      <BottomSheet open onClose={onClose} title="Settings" className="flex max-h-[90dvh] flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{content}</div>
      </BottomSheet>
    )
  }

  // Desktop: the centered modal card with a ✕ header (unchanged).
  return (
    <div
      role="dialog"
      aria-label="Settings"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[calc(2.5rem_+_env(safe-area-inset-top))]"
      onClick={onClose}
    >
      <section
        className="w-full max-w-2xl rounded-xl border border-border-strong bg-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-2 flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-ink">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="text-muted hover:text-ink"
          >
            ✕
          </button>
        </header>
        {content}
      </section>
    </div>
  )
}
