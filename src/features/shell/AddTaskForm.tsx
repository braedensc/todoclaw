import { useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { quadrantMeta, type QuadrantKey } from '../../lib/quadrants'
import { QUADRANT_ORDER, QUADRANT_CENTER, QUADRANT_SUBTITLE } from '../../lib/quadrant-summary'
import { QUADRANT_TINT } from '../grid/grid-constants'
import type { Recurring } from '../../types/task'
import { formatDueTime } from '../../lib/dates'
import { fmtFrequency } from '../../lib/recurring'
import { SchedulePanel } from '../schedule/SchedulePanel'
import { useTimeZone } from '../schedule/use-time-zone'

// AddTaskForm — the mobile "add a task" form (rendered inside MobileAddSheet's bottom sheet).
// Reworked ground-up from the full-screen takeover after the 2026-07-08 feedback round:
//
//  - Text first, but NOT auto-focused — the keyboard pops only when the user taps the field
//    (auto-opening it on every sheet open was the #1 annoyance).
//  - The quadrant picker is framed as the question it actually answers — "How urgent +
//    important is it?" — with a one-line note that the choice just places the task on the
//    priority grid. The 2×2 keeps the canonical quadrant names/colors.
//  - Scheduling (due / time / remind / repeats) is the shared SchedulePanel (workshop
//    2026-07-09) behind an "Add schedule" DISCLOSURE: capture stays one screen tall — the
//    calendar only unfolds when the task actually needs a date. The panel writes into this
//    form's DRAFT state; nothing persists until "Add task".
//  - A full-width Add button, and a quiet 🐾 tip that CHAT is the fastest capture path
//    ("add call mom tomorrow, urgent, daily" — BabyClaw phrases, places, and schedules it).
//
// The form remounts on each sheet open (BottomSheet renders nothing while closed), so useState
// initializers reset the draft/selection with no reset-in-effect.

function display(key: QuadrantKey) {
  const c = QUADRANT_CENTER[key]
  return quadrantMeta(c.x, c.y)
}

/** "Sat 07-11 · 3:00 PM · weekly" — the collapsed disclosure echoes the drafted schedule. */
export function scheduleSummary(
  due: string | null,
  dueTime: string | null,
  recurring: Recurring | null,
): string | null {
  const parts: string[] = []
  if (due) parts.push(due.slice(5) + (dueTime ? ` · ${formatDueTime(dueTime)}` : ''))
  if (recurring) parts.push(fmtFrequency(recurring.frequencyDays))
  return parts.length ? parts.join(' · ') : null
}

export function AddTaskForm({
  defaultQuadrant,
  onAdd,
  reminderDefault,
  onOpenChat,
  inputRef,
}: {
  defaultQuadrant: QuadrantKey | null
  /** Create the task: text + quadrant + optional recurring + optional due date/time + an optional
   *  reminder offset (minutes before the due instant; null = none). */
  onAdd: (
    text: string,
    dest: QuadrantKey,
    recurring: Recurring | null,
    due: string | null,
    dueTime: string | null,
    reminderMinutes: number | null,
  ) => void
  /** The add-flow reminder default (from settings) — pre-selects the picker once a time is set. */
  reminderDefault: number | null
  /** Optional "fastest way is Chat" tip — tapping it closes this sheet and opens BabyClaw. */
  onOpenChat?: () => void
  /** The text field, exposed so the caller can focus it explicitly if ever needed (NOT focused
   *  on open — the keyboard must not pop until the user asks for it). */
  inputRef?: RefObject<HTMLInputElement>
}) {
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<QuadrantKey | null>(defaultQuadrant)
  // Schedule DRAFT — the SchedulePanel writes here through the same callback shapes it uses
  // everywhere else; nothing reaches the DB until "Add task" ships the whole draft at once.
  const [due, setDue] = useState<string | null>(null)
  const [dueTime, setDueTime] = useState<string | null>(null)
  const [recurring, setRecurring] = useState<Recurring | null>(null)
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(reminderDefault)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const timeZone = useTimeZone()

  const canAdd = text.trim().length > 0 && selected != null
  const summary = scheduleSummary(due, dueTime, recurring)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canAdd || selected == null) return
    // A time never ships without a date (DB CHECK) — the panel guarantees it, this guards it.
    const dt = due ? dueTime : null
    onAdd(text.trim(), selected, recurring, due, dt, dt ? reminderMinutes : null)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pt-1">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Task text"
        placeholder="What needs doing?"
        enterKeyHint="done"
        className="w-full rounded-xl border border-border-strong bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted-light focus:border-primary"
      />

      <div>
        <p className="mb-0.5 text-[13px] font-semibold text-ink">How urgent + important is it?</p>
        <p className="mb-2 text-xs text-muted">
          This just places it on your priority grid — you can always move it later.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {QUADRANT_ORDER.map((key) => {
            const m = display(key)
            const on = key === selected
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                aria-pressed={on}
                aria-label={m.label}
                className={
                  'flex min-h-[56px] flex-col gap-0.5 rounded-2xl border border-border-strong px-3 py-2 text-left transition ' +
                  (on ? '' : 'opacity-70')
                }
                style={{
                  borderLeft: `4px solid ${m.color}`,
                  background: QUADRANT_TINT[key],
                  ...(on ? { boxShadow: `0 0 0 2px ${m.color}` } : {}),
                }}
              >
                <span className="font-serif text-sm font-semibold" style={{ color: m.color }}>
                  {m.label}
                </span>
                <span className="text-[11px] text-muted-light">{QUADRANT_SUBTITLE[key]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Schedule — the shared SchedulePanel behind a DISCLOSURE, so plain capture stays one
          screen tall (the mobile-flows golden pins that) and the calendar only unfolds on
          demand. The collapsed chip echoes the drafted schedule once one exists. */}
      <div>
        <button
          type="button"
          aria-expanded={scheduleOpen}
          onClick={() => setScheduleOpen((o) => !o)}
          className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-border-strong bg-card px-3 text-left text-[13px] transition-colors hover:border-muted-faint"
        >
          <span className="font-semibold text-ink">
            <span aria-hidden>⏰</span> Add schedule{' '}
            {!summary && <span className="font-normal text-muted">(optional)</span>}
          </span>
          <span className="flex items-center gap-2">
            {summary && <span className="font-medium text-primary">{summary}</span>}
            <span aria-hidden className="text-muted">
              {scheduleOpen ? '▴' : '▾'}
            </span>
          </span>
        </button>
        {scheduleOpen && (
          <div className="mt-2 rounded-xl border border-border bg-panel p-3">
            <SchedulePanel
              taskText={text.trim() || 'New task'}
              due={due}
              dueTime={dueTime}
              recurring={recurring}
              timeZone={timeZone}
              onSetDue={(d, t) => {
                setDue(d)
                setDueTime(t)
              }}
              onSetRecurring={(n) =>
                setRecurring({ frequencyDays: n, lastDoneAt: null, doneCount: 0 })
              }
              onSetFrequency={(n) =>
                setRecurring((r) =>
                  r
                    ? { ...r, frequencyDays: n }
                    : { frequencyDays: n, lastDoneAt: null, doneCount: 0 },
                )
              }
              onRemoveRecurring={() => setRecurring(null)}
              reminderOffset={reminderMinutes}
              onSetReminder={setReminderMinutes}
              idPrefix="madd"
              touch
            />
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={!canAdd}
        className="min-h-[48px] w-full rounded-xl bg-primary px-4 text-base font-semibold text-white transition-opacity disabled:opacity-50"
      >
        Add task
      </button>

      {/* The fastest path is BabyClaw — say so where adding happens. Tappable: closes this sheet
          and opens the chat (App wires it). */}
      {onOpenChat && (
        <button
          type="button"
          onClick={onOpenChat}
          className="-mt-1 rounded-lg px-1 py-1.5 text-left text-xs leading-snug text-muted hover:text-ink"
        >
          <span aria-hidden>🐾</span> <span className="font-semibold">Tip:</span> chatting is the
          fastest way to add — try{' '}
          <span className="italic">“add call landlord tomorrow, urgent, repeat weekly”</span>
        </button>
      )}
    </form>
  )
}
