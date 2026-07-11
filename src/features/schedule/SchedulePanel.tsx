import { useState } from 'react'
import type { Recurring } from '../../types/task'
import { localDateInTZ } from '../../lib/dates'
import { recurringStatus, RC_COLOR, fmtFrequency, ongoingLabel } from '../../lib/recurring'
import { ReminderPicker } from '../reminders/ReminderPicker'
import { RecurringReminderPicker } from '../reminders/RecurringReminderPicker'
import { DueTimezoneHint } from './DueTimezoneHint'

// SchedulePanel — the ONE schedule editor (2026-07-09 workshop, direction B "calendar-first",
// owner-approved). Everything about WHEN a task comes back lives here in one vocabulary:
//
//   · a two-week paper calendar (today outlined, Monday-start, timezone-aware via localDateInTZ),
//     with "More dates…" revealing the native date input as the far-future escape hatch
//   · time preset chips (None / 9 AM / Noon / 6 PM / Custom… → native time input)
//   · the existing Remind-me chips (ReminderPicker), gated on a due time + not recurring
//   · a Repeats segmented control (Off / Daily / Weekly / Every… → a ±N-days stepper) replacing
//     the old bare "days between repeats [Set]" stepper
//
// Commit semantics are unchanged from the inputs it replaces: every tap writes immediately via
// the SAME callback contracts the old controls used (onSetDue always writes both columns — the
// DB CHECK forbids a time without a date; Daily/Weekly preserve lastDoneAt/doneCount on an
// already-recurring task via onSetFrequency, and only a fresh schedule goes through
// onSetRecurring). PR 1 mounts it in the grid card's ⋯ menu; the expanded list row, the add
// form, and the mobile bottom sheet adopt it next so the surfaces can't drift again.
//
// The 🦴 on an active repeat is the workshop's "subtle garnish" — personality in the readback,
// never in the mechanics. (The header is deliberately PLAIN — "Set a due date": the workshop's
// "When should this come back to you?" phrasing read unclear in practice; owner feedback
// 2026-07-09.)

/** Time preset chips: label → 'HH:MM' (null = clear the time). */
const TIME_PRESETS: Array<{ label: string; value: string | null }> = [
  { label: 'None', value: null },
  { label: '9 AM', value: '09:00' },
  { label: 'Noon', value: '12:00' },
  { label: '6 PM', value: '18:00' },
]

/** Days shown by the calendar: this week + next (Monday-start), matching the workshop mock. */
const CALENDAR_DAYS = 14

/** Default cadence seeded into the "Every…" stepper before the user adjusts it. */
const CUSTOM_REPEAT_SEED = 3

/** Default check-in cadence for a freshly-made ongoing project (resurface every 2 days). */
const ONGOING_DEFAULT_CHECK_IN = 2

/**
 * Calendar-day arithmetic on ISO 'YYYY-MM-DD' strings, done entirely in UTC at noon so it is
 * pure date math — no local-tz drift, no DST edge (the CLAUDE.md "never new Date('YYYY-MM-DD')"
 * rule is about projecting a date to a LOCAL instant; here we never leave UTC).
 */
function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Monday of the week containing `iso` (ISO weeks start Monday). */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  return addDaysISO(iso, -dow)
}

/** Host-locale display bits for a calendar cell, computed from the ISO day in UTC. */
function cellParts(iso: string): { dayNum: number; monthShort: string; aria: string } {
  const d = new Date(`${iso}T12:00:00Z`)
  return {
    dayNum: d.getUTCDate(),
    monthShort: d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }),
    aria: d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }),
  }
}

export interface SchedulePanelProps {
  /** Task text echoed under the header so the panel says WHAT it is scheduling. */
  taskText: string
  /** Current wall-clock due date ('YYYY-MM-DD', may arrive as a longer ISO — sliced) or null. */
  due: string | null
  /** Current due time ('HH:MM' or the wire 'HH:MM:SS') or null. */
  dueTime: string | null
  recurring: Recurring | null
  /** IANA zone that defines "today" for the calendar — same authority as the daily reset. */
  timeZone: string
  /** Commit due date + time. Always both columns: clearing the date clears the time with it. */
  onSetDue: (due: string | null, dueTime: string | null) => void
  /** Set a fresh recurring schedule of N days (lastDoneAt null, doneCount 0). */
  onSetRecurring: (frequencyDays: number) => void
  /** Change an already-recurring task's cadence (preserves lastDoneAt + doneCount). */
  onSetFrequency: (frequencyDays: number) => void
  /** Drop the recurring schedule. */
  onRemoveRecurring: () => void
  /**
   * Make / adjust this task as an ONGOING project: a check-in cadence (days) + an optional
   * target-end ('YYYY-MM-DD' or null). Reuses the recurring jsonb under the hood. Provided only on
   * surfaces that offer ongoing editing (the list expanded row); where omitted, the ongoing
   * controls are hidden and an already-ongoing task shows a read-only status line.
   */
  onSetOngoing?: (checkInDays: number, targetEnd: string | null) => void
  /** Finish an ongoing project — archive it to the Done log (list expanded row only). */
  onFinishOngoing?: () => void
  /** This task's selected reminder offsets (minutes before due); empty = none. Multi-select. */
  reminderOffsets: readonly number[]
  /** Toggle one reminder lead time on/off. */
  onToggleReminder: (minutes: number) => void
  /** Clear every reminder on this task (the Off chip). */
  onClearReminders: () => void
  /**
   * For a RECURRING task: its single time-of-day reminder ('HH:MM' / 'HH:MM:SS'), or null = none.
   * Provided only on surfaces that support recurring reminders (the grid/list/cluster editors);
   * where `onSetRecurringReminderTime` is omitted the recurring "Remind me at" control is hidden
   * (e.g. the add surfaces, where the task doesn't exist yet).
   */
  recurringReminderTime?: string | null
  /** Set ('HH:MM') or clear (null) the recurring task's fixed-cadence reminder time. */
  onSetRecurringReminderTime?: (hhmm: string | null) => void
  /** Namespaces the ReminderPicker testid when several panels mount (grid / list / add). */
  idPrefix?: string
  /** Thumb-sized controls for touch surfaces (mobile add sheet / expanded row on a phone):
   *  bigger chips, 40px calendar cells and segments. Desktop popovers stay compact. */
  touch?: boolean
  /** Test seam: the instant "today" is computed from (defaults to now). */
  now?: Date
}

export function SchedulePanel({
  taskText,
  due,
  dueTime,
  recurring,
  timeZone,
  onSetDue,
  onSetRecurring,
  onSetFrequency,
  onRemoveRecurring,
  onSetOngoing,
  onFinishOngoing,
  reminderOffsets,
  onToggleReminder,
  onClearReminders,
  recurringReminderTime,
  onSetRecurringReminderTime,
  idPrefix,
  touch = false,
  now,
}: SchedulePanelProps) {
  const dueValue = due ? due.slice(0, 10) : ''
  const timeValue = dueTime ? dueTime.slice(0, 5) : ''

  // Two size grades from one prop: compact for desktop popovers, thumb-sized for touch surfaces.
  const chipBase = `rounded-full border font-medium transition-colors disabled:opacity-40 ${
    touch ? 'px-3.5 py-2 text-[13px]' : 'px-2.5 py-1 text-xs'
  }`
  const chipOff = `${chipBase} border-border-strong bg-card text-muted hover:text-ink`
  const chipOn = `${chipBase} border-primary bg-primary text-white`
  const segBase = `rounded-lg font-semibold transition-colors ${
    touch ? 'min-h-[40px] flex-1 px-3 text-[13px]' : 'px-3 py-1.5 text-xs'
  }`
  const segOff = `${segBase} text-muted hover:text-ink`
  const segOn = `${segBase} bg-card text-ink shadow-sm`
  const cellH = touch ? 'h-10' : 'h-8'

  // Today in the USER's timezone — the same authority the daily reset uses. The fortnight starts
  // on this week's Monday so the row layout matches a wall calendar, not a rolling window.
  const todayISO = localDateInTZ(timeZone, now)
  const start = mondayOf(todayISO)
  const cells = Array.from({ length: CALENDAR_DAYS }, (_, i) => addDaysISO(start, i))

  // The native date input is the escape hatch for dates beyond the fortnight. It stays revealed
  // whenever the current due can't be seen (or picked again) on the calendar itself.
  const dueOffGrid = dueValue !== '' && !cells.includes(dueValue)
  const [moreOpen, setMoreOpen] = useState(dueOffGrid)
  const showMore = moreOpen || dueOffGrid

  // Custom time reveal — auto-open when the stored time isn't one of the presets.
  const timeIsPreset = TIME_PRESETS.some((p) => (p.value ?? '') === timeValue)
  const [customTimeOpen, setCustomTimeOpen] = useState(!timeIsPreset && timeValue !== '')
  const showCustomTime = customTimeOpen || (!timeIsPreset && timeValue !== '')

  // Repeats: derived mode unless the user opened the "Every…" stepper (a UI-only draft until the
  // first ± press commits). Daily/Weekly presets are exact-match so e.g. every-3-days reads Every….
  const freq = recurring?.frequencyDays ?? null
  const [customRepeatOpen, setCustomRepeatOpen] = useState(
    freq !== null && freq !== 1 && freq !== 7,
  )
  const [draftN, setDraftN] = useState(
    freq !== null && freq !== 1 && freq !== 7 ? freq : CUSTOM_REPEAT_SEED,
  )
  const repeatMode: 'off' | 'daily' | 'weekly' | 'custom' = customRepeatOpen
    ? 'custom'
    : freq === null
      ? 'off'
      : freq === 1
        ? 'daily'
        : freq === 7
          ? 'weekly'
          : 'custom'

  const status = recurringStatus(recurring)
  const statusColor = status ? RC_COLOR[status.code] : RC_COLOR.ok

  // Ongoing project: the recurring engine reframed as a continuous multi-week effort. When set it
  // OWNS the Repeats slot (the chore segmented control is replaced), reusing frequencyDays as the
  // check-in cadence. The editor (stepper / target-end / Finish) shows only where onSetOngoing is
  // wired (the list expanded row); elsewhere an ongoing task just reads its status line.
  const isOngoing = !!recurring?.ongoing
  const ongoing = ongoingLabel(recurring, { now, timeZone })
  const ongoingFreq = recurring?.frequencyDays ?? ONGOING_DEFAULT_CHECK_IN
  const ongoingTargetValue = recurring?.targetEnd ? recurring.targetEnd.slice(0, 10) : ''
  const stepBtn =
    'h-7 w-7 rounded-lg border border-border-strong bg-card text-sm text-muted hover:text-ink'

  // Month header: "Jul" or "Jul – Aug" when the fortnight spans a boundary.
  const firstMonth = cellParts(cells[0] ?? todayISO).monthShort
  const lastMonth = cellParts(cells[cells.length - 1] ?? todayISO).monthShort
  const monthLabel = firstMonth === lastMonth ? firstMonth : `${firstMonth} – ${lastMonth}`

  /** Pick a calendar day (keeps any time already set). */
  const pickDay = (iso: string) => onSetDue(iso, timeValue || null)

  /** Set a preset/custom time — requires a date (chips are disabled without one). */
  const pickTime = (value: string | null) => {
    if (!dueValue) return
    onSetDue(dueValue, value)
  }

  /** Repeats presets: preserve history on an already-recurring task, fresh schedule otherwise. */
  const commitCadence = (days: number) => {
    if (recurring) onSetFrequency(days)
    else onSetRecurring(days)
  }

  const pickCadence = (days: number) => {
    setCustomRepeatOpen(false)
    commitCadence(days)
  }

  /** Opening Every… IS choosing a cadence (consistent with Daily/Weekly committing on tap):
   *  it commits the seed (or the existing custom value) immediately; ± then adjusts it. */
  const openCustomCadence = () => {
    if (customRepeatOpen) return
    setCustomRepeatOpen(true)
    if (freq !== draftN) commitCadence(draftN)
  }

  /** ± on the Every… stepper: clamp to [2, 365] and commit each press (instant-commit panel). */
  const stepCustom = (delta: number) => {
    const next = Math.min(365, Math.max(2, draftN + delta))
    setDraftN(next)
    commitCadence(next)
  }

  const sectionLabel = 'block text-[10px] font-bold uppercase tracking-[0.09em] text-muted-light'

  return (
    <div className="flex flex-col gap-3 text-ink">
      {/* Plain header (owner feedback 2026-07-09: the "come back to you" phrasing read unclear) —
          the panel says what it does and gets out of the way. The 🦴 garnish below stays. */}
      <div className="flex flex-col">
        <span className="text-[13px] font-bold">Set a due date</span>
        <span className="truncate text-[11px] text-muted-light">{taskText}</span>
      </div>

      {/* ---- Due: the two-week paper calendar ---- */}
      <div>
        <span className={sectionLabel}>{monthLabel}</span>
        <div
          role="group"
          aria-label="Due day"
          className="mt-1.5 grid grid-cols-7 gap-1"
          data-testid="schedule-calendar"
        >
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span
              key={`dow-${i}`}
              aria-hidden
              className="text-center text-[9px] font-bold tracking-wide text-muted-faint"
            >
              {d}
            </span>
          ))}
          {cells.map((iso) => {
            const { dayNum, aria } = cellParts(iso)
            const selected = iso === dueValue
            const isToday = iso === todayISO
            const isPast = iso < todayISO
            return (
              <button
                key={iso}
                type="button"
                aria-label={aria}
                aria-pressed={selected}
                onClick={() => pickDay(iso)}
                className={`${cellH} rounded-lg border text-xs transition-colors ${
                  selected
                    ? 'border-primary bg-primary font-bold text-white'
                    : isToday
                      ? 'border-accent font-bold text-accent hover:bg-bg'
                      : `border-transparent hover:bg-bg ${isPast ? 'text-muted-faint' : 'text-ink'}`
                }`}
              >
                {dayNum}
              </button>
            )
          })}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            aria-expanded={showMore}
            onClick={() => setMoreOpen((o) => !o)}
            className={chipOff}
          >
            📅 More dates…
          </button>
          <button
            type="button"
            disabled={!dueValue}
            onClick={() => onSetDue(null, null)}
            className={chipOff}
          >
            No date
          </button>
        </div>
        {showMore && (
          <input
            type="date"
            aria-label="Due date"
            value={dueValue}
            onChange={(e) => {
              const v = e.target.value === '' ? null : e.target.value
              onSetDue(v, v ? timeValue || null : null)
            }}
            className="mt-1.5 w-full rounded border border-border-strong bg-card px-2 py-1 text-xs"
          />
        )}
      </div>

      {/* ---- Time presets (a reminder needs an instant; chips wait for a date) ---- */}
      <div>
        <span className={sectionLabel}>Time</span>
        {/* "Time presets", NOT "Due time presets" — getByLabel/getByRole match by substring, so a
            "Due time…" group label would collide with the native input's "Due time" in every spec. */}
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Time presets">
          {TIME_PRESETS.map((p) => {
            // Exactly one pressed chip: while the Custom reveal is open it owns the pressed state
            // (even if the input still holds a preset value).
            const on = !showCustomTime && (p.value ?? '') === timeValue
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={on}
                disabled={!dueValue}
                title={dueValue ? undefined : 'Pick a day first'}
                onClick={() => {
                  setCustomTimeOpen(false)
                  pickTime(p.value)
                }}
                className={on ? chipOn : chipOff}
              >
                {p.label}
              </button>
            )
          })}
          <button
            type="button"
            aria-pressed={showCustomTime}
            disabled={!dueValue}
            title={dueValue ? undefined : 'Pick a day first'}
            onClick={() => setCustomTimeOpen(true)}
            className={showCustomTime ? chipOn : chipOff}
          >
            Custom…
          </button>
        </div>
        {showCustomTime && (
          <input
            type="time"
            aria-label="Due time"
            value={timeValue}
            disabled={!dueValue}
            onChange={(e) => pickTime(e.target.value === '' ? null : e.target.value)}
            className="mt-1.5 rounded border border-border-strong bg-card px-2 py-1 text-xs disabled:opacity-40"
          />
        )}
      </div>

      {/* ---- Remind me. TWO shapes from one slot: a RECURRING task gets a fixed-cadence alarm at a
              time of day (fires every cycle at that time, no due date needed — the pill-at-noon
              case); a one-off TIMED task gets lead-time chips (1 day AND 1 hour before, etc.). The
              recurring control shows only where the surface wired onSetRecurringReminderTime (the
              grid/list editors); the add surfaces omit it (no task id yet). ---- */}
      {recurring && onSetRecurringReminderTime ? (
        <div>
          <span className={sectionLabel}>Remind me</span>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">
            Ping at a set time each cycle — fires whether or not you’ve marked it done.
          </p>
          <div className="mt-1.5">
            <RecurringReminderPicker
              value={recurringReminderTime ?? null}
              onChange={onSetRecurringReminderTime}
              idPrefix={idPrefix}
            />
          </div>
        </div>
      ) : (
        dueValue &&
        timeValue &&
        !recurring && (
          <div>
            <span className={sectionLabel}>Remind me</span>
            <div className="mt-1.5">
              <ReminderPicker
                values={reminderOffsets}
                onToggle={onToggleReminder}
                onClear={onClearReminders}
                idPrefix={idPrefix}
              />
            </div>
          </div>
        )
      )}

      {/* ---- Repeat this task (chore) OR Ongoing project — one slot, both live in `recurring`.
              #227 set the chore case off with a divider + "Repeat this task" header/help; the
              ongoing case swaps in the project editor instead. ---- */}
      <div className="border-t border-border pt-3">
        {isOngoing ? (
          <>
            <span className={sectionLabel}>Ongoing project</span>
            <div className="mt-1.5 flex flex-col gap-2">
              {/* Readback: sessions logged + optional target countdown + the check-in status. */}
              <p className="text-[11px]" style={{ color: statusColor }}>
                ▶ ongoing · {ongoing?.sessions ?? 0}{' '}
                {ongoing?.sessions === 1 ? 'session' : 'sessions'}
                {ongoing?.target ? ` · ${ongoing.target}` : ''}
                {status ? ` · ${status.label}` : ''}
              </p>

              {onSetOngoing && (
                <>
                  {/* Check-in cadence: how often the project resurfaces (reuses frequencyDays). */}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted">check in every</span>
                    <button
                      type="button"
                      aria-label="Check in less often"
                      onClick={() =>
                        onSetOngoing(Math.max(1, ongoingFreq - 1), recurring?.targetEnd ?? null)
                      }
                      className={stepBtn}
                    >
                      −
                    </button>
                    <b className="min-w-[64px] text-center text-xs">{ongoingFreq} days</b>
                    <button
                      type="button"
                      aria-label="Check in more often"
                      onClick={() =>
                        onSetOngoing(Math.min(365, ongoingFreq + 1), recurring?.targetEnd ?? null)
                      }
                      className={stepBtn}
                    >
                      +
                    </button>
                  </div>

                  {/* Optional target-end date — a soft finish line, not a hard due date. */}
                  <label className="flex items-center gap-2 text-[11px] text-muted">
                    target end
                    <input
                      type="date"
                      aria-label="Target end date"
                      value={ongoingTargetValue}
                      onChange={(e) =>
                        onSetOngoing(ongoingFreq, e.target.value === '' ? null : e.target.value)
                      }
                      className="rounded border border-border-strong bg-card px-2 py-1 text-xs"
                    />
                  </label>

                  {/* Terminal actions: Finish archives to Done (a plain chore has no finish line);
                    End reverts to a normal one-time task. */}
                  <div className="flex flex-wrap items-center gap-2">
                    {onFinishOngoing && (
                      <button type="button" onClick={onFinishOngoing} className={chipOn}>
                        ✓ Finish project
                      </button>
                    )}
                    <button type="button" onClick={onRemoveRecurring} className={chipOff}>
                      End ongoing
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <span className={sectionLabel}>
              <span aria-hidden>↻ </span>Repeat this task
            </span>
            <p className="mt-0.5 text-[11px] leading-snug text-muted">
              The task itself comes back on a schedule — marking it done just resets its timer
              instead of sending it to Done. This is about the task, not a reminder.
            </p>
            <div
              role="group"
              aria-label="Repeats"
              className={`mt-1.5 gap-0.5 rounded-[10px] bg-bg p-0.5 ${touch ? 'flex w-full' : 'inline-flex'}`}
            >
              <button
                type="button"
                aria-pressed={repeatMode === 'off'}
                onClick={() => {
                  setCustomRepeatOpen(false)
                  if (recurring) onRemoveRecurring()
                }}
                className={repeatMode === 'off' ? segOn : segOff}
              >
                Off
              </button>
              <button
                type="button"
                aria-pressed={repeatMode === 'daily'}
                onClick={() => pickCadence(1)}
                className={repeatMode === 'daily' ? segOn : segOff}
              >
                Daily
              </button>
              <button
                type="button"
                aria-pressed={repeatMode === 'weekly'}
                onClick={() => pickCadence(7)}
                className={repeatMode === 'weekly' ? segOn : segOff}
              >
                Weekly
              </button>
              <button
                type="button"
                aria-pressed={repeatMode === 'custom'}
                onClick={openCustomCadence}
                className={repeatMode === 'custom' ? segOn : segOff}
              >
                Every…
              </button>
            </div>
            {repeatMode === 'custom' && (
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Fewer days between repeats"
                  onClick={() => stepCustom(-1)}
                  className={stepBtn}
                >
                  −
                </button>
                <b className="min-w-[64px] text-center text-xs">{draftN} days</b>
                <button
                  type="button"
                  aria-label="More days between repeats"
                  onClick={() => stepCustom(1)}
                  className={stepBtn}
                >
                  +
                </button>
              </div>
            )}
            {/* Garnish: the repeat reads back in plain words, with the bone stamp + live status. */}
            {recurring && status && (
              <p className="mt-1.5 text-[11px]" style={{ color: statusColor }}>
                comes back {fmtFrequency(recurring.frequencyDays)} 🦴 · {status.label}
              </p>
            )}
            {/* Promote a big multi-week effort to an ongoing project (list expanded row only). */}
            {onSetOngoing && (
              <button
                type="button"
                onClick={() => onSetOngoing(ONGOING_DEFAULT_CHECK_IN, null)}
                className="mt-2 block text-[11px] font-medium text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
              >
                ▶ Make it an ongoing project
              </button>
            )}
          </>
        )}
      </div>

      <DueTimezoneHint />
    </div>
  )
}
