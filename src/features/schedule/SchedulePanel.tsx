import { useState } from 'react'
import type { Recurring } from '../../types/task'
import { localDateInTZ } from '../../lib/dates'
import { recurringStatus, RC_COLOR, fmtFrequency } from '../../lib/recurring'
import { ReminderPicker } from '../reminders/ReminderPicker'
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
// The header phrasing and the 🦴 on an active repeat are the workshop's "subtle garnish" —
// personality in the framing, never in the mechanics.

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
  /** This task's reminder offset (minutes before due), or null. */
  reminderOffset: number | null
  /** Set/clear this task's reminder (minutes-before, null = off). */
  onSetReminder: (minutes: number | null) => void
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
  reminderOffset,
  onSetReminder,
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
      {/* Garnish lives in the framing, not the mechanics: the panel asks the product's actual
          question, then behaves like a boring, fast scheduler. */}
      <div className="flex flex-col">
        <span className="text-[13px] font-bold">When should this come back to you?</span>
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

      {/* ---- Remind me — unchanged gating: a due time to anchor to, and never for a repeat ---- */}
      {dueValue && timeValue && !recurring && (
        <div>
          <span className={sectionLabel}>Remind me</span>
          <div className="mt-1.5">
            <ReminderPicker value={reminderOffset} onChange={onSetReminder} idPrefix={idPrefix} />
          </div>
        </div>
      )}

      {/* ---- Repeats: segmented presets + the Every… stepper ---- */}
      <div>
        <span className={sectionLabel}>Repeats</span>
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
              className="h-7 w-7 rounded-lg border border-border-strong bg-card text-sm text-muted hover:text-ink"
            >
              −
            </button>
            <b className="min-w-[64px] text-center text-xs">{draftN} days</b>
            <button
              type="button"
              aria-label="More days between repeats"
              onClick={() => stepCustom(1)}
              className="h-7 w-7 rounded-lg border border-border-strong bg-card text-sm text-muted hover:text-ink"
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
      </div>

      <DueTimezoneHint />
    </div>
  )
}
