import { useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { quadrantMeta, type QuadrantKey } from '../../lib/quadrants'
import { QUADRANT_ORDER, QUADRANT_CENTER, QUADRANT_SUBTITLE } from '../../lib/quadrant-summary'
import { QUADRANT_TINT } from '../grid/grid-constants'
import type { Recurring } from '../../types/task'
import { DueTimezoneHint } from '../schedule/DueTimezoneHint'
import { ReminderPicker } from '../reminders/ReminderPicker'

// AddTaskForm — the mobile "add a task" form (rendered inside MobileAddSheet's bottom sheet).
// Reworked ground-up from the full-screen takeover after the 2026-07-08 feedback round:
//
//  - Text first, but NOT auto-focused — the keyboard pops only when the user taps the field
//    (auto-opening it on every sheet open was the #1 annoyance).
//  - The quadrant picker is framed as the question it actually answers — "How urgent +
//    important is it?" — with a one-line note that the choice just places the task on the
//    priority grid. The 2×2 keeps the canonical quadrant names/colors.
//  - A Repeats row (Off / Daily / Weekly / Every N days) so recurring chores can be created
//    here instead of add-then-expand-then-set — the old sheet had no recurring path at all.
//  - A full-width Add button, and a quiet 🐾 tip that CHAT is the fastest capture path
//    ("add call mom tomorrow, urgent, daily" — BabyClaw phrases, places, and schedules it).
//
// The form remounts on each sheet open (BottomSheet renders nothing while closed), so useState
// initializers reset the draft/selection with no reset-in-effect.

function display(key: QuadrantKey) {
  const c = QUADRANT_CENTER[key]
  return quadrantMeta(c.x, c.y)
}

// Repeat presets: value = frequencyDays; 'custom' reveals the days input; null = one-off.
const REPEAT_CHOICES = [
  { label: 'Off', value: null },
  { label: 'Daily', value: 1 },
  { label: 'Weekly', value: 7 },
  { label: 'Custom', value: 'custom' },
] as const

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
  const [repeat, setRepeat] = useState<(typeof REPEAT_CHOICES)[number]['value']>(null)
  const [customDays, setCustomDays] = useState('')
  const [due, setDue] = useState<string | null>(null)
  const [dueTime, setDueTime] = useState<string | null>(null)
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(reminderDefault)

  const frequencyDays =
    repeat === 'custom' ? Math.floor(Number(customDays)) : repeat === null ? null : repeat
  const repeatValid = repeat !== 'custom' || (Number.isFinite(frequencyDays) && frequencyDays! >= 1)
  const canAdd = text.trim().length > 0 && selected != null && repeatValid

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canAdd || selected == null) return
    const recurring: Recurring | null =
      frequencyDays != null && frequencyDays >= 1
        ? { frequencyDays, lastDoneAt: null, doneCount: 0 }
        : null
    // A time never ships without a date (DB CHECK) — the control disables it, this guards it.
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

      {/* Due — optional date + time (time unlocks once a date is picked). text-base keeps iOS
          from zooming the focused input (the 16px rule); 44px min-height for touch targets. */}
      <div>
        <p className="mb-1.5 text-[13px] font-semibold text-ink">
          <span aria-hidden>📅</span> Due <span className="font-normal text-muted">(optional)</span>
        </p>
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="Due date"
            value={due ?? ''}
            onChange={(e) => {
              const v = e.target.value === '' ? null : e.target.value
              setDue(v)
              if (!v) setDueTime(null)
            }}
            className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-border-strong bg-card px-3 text-base text-ink focus:border-primary focus:outline-none"
          />
          <input
            type="time"
            aria-label="Due time"
            value={dueTime ?? ''}
            disabled={!due}
            title={due ? undefined : 'Set a date first'}
            onChange={(e) => setDueTime(e.target.value === '' ? null : e.target.value)}
            className="min-h-[44px] rounded-xl border border-border-strong bg-card px-3 text-base text-ink focus:border-primary focus:outline-none disabled:opacity-40"
          />
        </div>
        <div className="mt-1">
          <DueTimezoneHint />
        </div>
        {/* Reminder — shown once a time is set; pre-selected to the user's default. */}
        {due && dueTime && (
          <div className="mt-2.5 flex flex-col gap-1.5">
            <p className="text-[13px] font-semibold text-ink">
              <span aria-hidden>⏰</span> Remind me
            </p>
            <ReminderPicker value={reminderMinutes} onChange={setReminderMinutes} idPrefix="madd" />
          </div>
        )}
      </div>

      {/* Repeats — creates the task with a recurring schedule (daily chores etc.) in one step. */}
      <div>
        <p className="mb-1.5 text-[13px] font-semibold text-ink">
          <span aria-hidden>↻</span> Repeats
        </p>
        <div
          role="group"
          aria-label="Repeats"
          className="flex items-center gap-1 rounded-xl border border-border bg-panel p-1"
        >
          {REPEAT_CHOICES.map((choice) => {
            const on = repeat === choice.value
            return (
              <button
                key={choice.label}
                type="button"
                onClick={() => setRepeat(choice.value)}
                aria-pressed={on}
                className={
                  'min-h-[40px] flex-1 rounded-lg px-2 text-[13px] font-medium transition-colors ' +
                  (on ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink')
                }
              >
                {choice.label}
              </button>
            )
          })}
        </div>
        {repeat === 'custom' && (
          <label className="mt-2 flex items-center gap-2 text-sm text-muted">
            every
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              aria-label="Days between repeats"
              placeholder="3"
              className="w-16 rounded border border-border-strong bg-card px-2 py-1 text-center text-sm"
            />
            days
          </label>
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
