import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useAddTask } from '../tasks/use-tasks'
import { useClickOutside } from '../../hooks/use-click-outside'
import type { Recurring } from '../../types/task'
import { SchedulePanel } from '../schedule/SchedulePanel'
import { useTimeZone } from '../schedule/use-time-zone'
import { useUserSchedule } from '../schedule/use-user-schedule'
import { useTaskReminderWrites } from '../reminders/use-task-reminders'
import { effectiveReminderDefault } from '../reminders/reminder-offsets'
import type { GridApi } from '../grid/use-grid'
import { NewItemStrip } from './NewItemStrip'
import { scheduleSummary } from './AddTaskForm'
import type { ChatController } from '../ai/use-chat-controller'
import { deriveBabyClawStatus, toolVerb } from './babyclaw-status'
import type { BabyClawStatus, BabyClawTone } from './babyclaw-status'
import { PawSteps } from '../../components/Thinking'

// The one "Task Manager" widget above the grid (B8, items 4/5/7/9; identity pass 2026-07-08).
// A framed, self-describing panel — the "Task Manager" title pill is notched into its top border
// so a first-time user knows what the box IS. Left rail: the Manual ⇄ BabyClaw pill toggle with
// "Open chat" right under it. The two modes share the row:
//  - MANUAL: "manually add task…" + Due + Repeat + Add. A just-added task materializes IN PLACE
//    as a draggable "Drag new item to grid" card (B2) that replaces the input; drag it onto the
//    grid and the input returns. No staging tray.
//  - BABYCLAW: a natural-language box routed through the EXISTING chat backend (the shared
//    ChatController). Every sub-line is attributed to 🐾 BabyClaw so it's obvious who's talking.
//    When BabyClaw STOPS on a question or a destructive-tool confirmation, the whole frame turns
//    terracotta and breathes, and a "waiting on your reply" strip (with inline Yes/No for
//    confirmations) makes the blocked state unmissable — even from Manual mode, where the
//    BabyClaw tab grows an attention dot. "Open chat" opens the drawer on whatever the WIDGET is
//    doing: this visit's conversation if one is going, else a brand-new chat (never the shared
//    controller's auto-resumed session, which the widget had no part in).

type Mode = 'manual' | 'babyclaw'

interface TaskInputWidgetProps {
  grid: GridApi
  chat: ChatController
  /** True when the Grid canvas is mounted (Grid view) — new-item cards are placeable only then. */
  canPlace: boolean
  /** Open the full chat drawer (BabyClaw "Open chat"). */
  onOpenChat: () => void
}

export function TaskInputWidget({ grid, chat, canPlace, onOpenChat }: TaskInputWidgetProps) {
  const [mode, setMode] = useState<Mode>('babyclaw')
  // Status reads THIS visit's live items only (not hydrated history) — else opening the app cold on
  // a resumed session would replay last night's "waiting on you" as if BabyClaw were actively stopped.
  const status = deriveBabyClawStatus({ ...chat, items: chat.liveItems })

  // "Open chat" follows THE WIDGET, not whatever session the controller happens to hold. The shared
  // controller auto-resumes the newest < 24h conversation at mount (use-ai-chat), so an untouched
  // widget used to open last night's history — a chat the user never started from here. Same
  // liveItems rule as the status line above: a live thread is this visit's streamed turns, plus a
  // confirmation still awaiting an answer (that one is restored from the resumed row and has no
  // liveItems of its own, so the waiting strip's "open the full chat" link must land ON the
  // question rather than wipe it). Nothing live → start a fresh chat, so the drawer opens where the
  // widget actually is. Sending still resumes as before; only this button re-anchors.
  const hasLiveThread = chat.liveItems.length > 0 || chat.pending !== null
  const handleOpenChat = () => {
    if (!hasLiveThread) chat.newChat()
    onOpenChat()
  }

  return (
    // mt-2.5 reserves room for the title pill straddling the top border. The section landmark
    // names the widget for AT; the visible pill is decorative (aria-hidden) so the name isn't
    // announced twice.
    <section aria-label="Task manager" data-tour="task-input" className="relative mt-2.5">
      {/* On BabyClaw's side the whole widget picks up a whisper of his slate-blue — a tinted
          border, a one-hairline ring, and a wash fading down from the top edge. Inline (not
          Tailwind opacity modifiers) to match how this file already does translucent color, and
          within STYLE.md's rule for the `puppy` token: BabyClaw-mode accents only. Manual mode
          drops back to the plain warm-paper widget. While BabyClaw is waiting on a reply the
          frame escalates to the terracotta breathing treatment (index.css) instead. */}
      <div
        className={
          'rounded-[10px] border bg-card p-2 transition-[border-color,box-shadow] duration-300 ' +
          (status.waiting && mode === 'babyclaw' ? 'babyclaw-waiting-frame' : 'border-border')
        }
        style={
          mode === 'babyclaw' && !status.waiting
            ? {
                borderColor: 'rgba(95, 138, 163, 0.45)',
                boxShadow:
                  '0 0 0 1px rgba(95, 138, 163, 0.14), 0 2px 10px -4px rgba(95, 138, 163, 0.25)',
                backgroundImage:
                  'linear-gradient(180deg, rgba(95, 138, 163, 0.045), rgba(255, 255, 255, 0) 60%)',
              }
            : undefined
        }
      >
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex shrink-0 flex-col items-start gap-1">
            <ModeToggle
              mode={mode}
              onSelect={setMode}
              attention={status.waiting && mode === 'manual'}
            />
            <button
              type="button"
              onClick={handleOpenChat}
              title={
                hasLiveThread
                  ? 'Open the full BabyClaw conversation'
                  : 'Start a new BabyClaw conversation'
              }
              className={
                'rounded px-2 py-0.5 text-[11px] transition-colors ' +
                (status.waiting
                  ? 'font-medium text-accent hover:opacity-80'
                  : 'text-muted hover:text-ink')
              }
            >
              Open chat <span aria-hidden>↗</span>
            </button>
          </div>
          {mode === 'manual' ? (
            <ManualInput grid={grid} canPlace={canPlace} />
          ) : (
            <BabyClawInput chat={chat} status={status} onOpenChat={handleOpenChat} />
          )}
        </div>
      </div>
      {/* The widget's name, notched into the top border like the grid's embedded view toggle. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-3.5 top-0 z-10 -translate-y-1/2 select-none rounded-full border border-border-strong bg-card px-2 py-px text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted"
      >
        Task Manager
      </span>
    </section>
  )
}

// --- Mode toggle -------------------------------------------------------------------------
function ModeToggle({
  mode,
  onSelect,
  attention,
}: {
  mode: Mode
  onSelect: (m: Mode) => void
  /** BabyClaw is waiting on a reply while Manual is selected — dot his tab so it can't be missed. */
  attention?: boolean
}) {
  return (
    <div
      role="group"
      aria-label="Add mode"
      className="inline-flex shrink-0 items-center rounded-full border border-border-strong bg-bg p-0.5"
    >
      {(
        [
          // 🐾 is BabyClaw's identity mark (his logo on his own tab) — distinct from the animated
          // ✦ thinking/working sparkle in babyclaw-status.ts, which stays as-is. BabyClaw is the
          // default/left-hand option — Manual is the fallback for anyone who wants to skip him.
          { id: 'babyclaw', label: 'BabyClaw', icon: '🐾' },
          { id: 'manual', label: 'Manual', icon: '✎' },
        ] as const
      ).map((m) => {
        const active = m.id === mode
        // BabyClaw's own tab gets a whisper of his namesake's blue when active — everything else
        // (Manual, both tabs' resting state) stays on the neutral warm-paper ring.
        const activeRing = m.id === 'babyclaw' ? 'ring-puppy/60' : 'ring-border-strong'
        const dotted = m.id === 'babyclaw' && attention
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            aria-pressed={active}
            title={dotted ? 'BabyClaw is waiting for your reply' : undefined}
            className={
              'relative flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ' +
              (active
                ? `bg-card text-ink shadow-sm ring-1 ${activeRing}`
                : 'text-muted hover:text-ink')
            }
          >
            <span aria-hidden>{m.icon}</span>
            {m.label}
            {dotted && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-bg"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

// --- Manual mode -------------------------------------------------------------------------

function ManualInput({ grid, canPlace }: { grid: GridApi; canPlace: boolean }) {
  const addTask = useAddTask()
  const reminderWrites = useTaskReminderWrites()
  // The user's configured add-flow default (1 hour unless changed / off). Pre-selects the picker
  // the moment a due time is set.
  const reminderDefault = effectiveReminderDefault(
    useUserSchedule().data?.config.notifications?.reminderDefaultMinutes,
  )
  const timeZone = useTimeZone()
  const [text, setText] = useState('')
  // Schedule DRAFT — the shared SchedulePanel (workshop 2026-07-09) writes here through its
  // usual callback shapes; the whole draft ships on Add. One chip replaces the old Due+Repeat
  // pair so the widget speaks the same vocabulary as every other schedule surface.
  const [due, setDue] = useState<string | null>(null)
  const [dueTime, setDueTime] = useState<string | null>(null)
  const [recurring, setRecurring] = useState<Recurring | null>(null)
  const [ongoing, setOngoing] = useState(false)
  const [reminderMinutes, setReminderMinutes] = useState<number[]>(
    reminderDefault != null ? [reminderDefault] : [],
  )
  const [scheduleOpen, setScheduleOpen] = useState(false)

  // Card-in-place (B2): a just-added task surfaces as a draggable card that REPLACES the input
  // (the pending strip below). One todo at a time — the input stays hidden until the pending card
  // is dragged onto the grid, then it returns for the next add.
  const pending = grid.pendingTasks
  const showForm = pending.length === 0

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    // A time never ships without a date (DB CHECK) — the control disables it, this guards it.
    const dt = due ? dueTime : null
    addTask.mutate(
      {
        text: trimmed,
        due,
        due_time: dt,
        recurring,
        ongoing,
      },
      {
        onSuccess: (created) => {
          // A timed task gets its chosen reminders right after creation (the task must exist first —
          // reminders FK its id). Recurring included: the reminder now leads each occurrence.
          if (dt) {
            for (const m of reminderMinutes) reminderWrites.add(created.id, m)
          }
          setText('')
          setDue(null)
          setDueTime(null)
          setReminderMinutes(reminderDefault != null ? [reminderDefault] : [])
          setRecurring(null)
          setOngoing(false)
        },
      },
    )
  }

  return (
    <div className="flex min-w-[220px] flex-1 flex-col gap-2">
      {pending.length > 0 && <NewItemStrip pending={pending} grid={grid} canPlace={canPlace} />}
      {showForm && (
        <form onSubmit={handleAdd} className="flex flex-1 flex-wrap items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="manually add task…"
            aria-label="Add a task"
            className="min-w-0 flex-1 rounded-lg border border-border-strong bg-card px-3 py-1.5 text-sm"
          />
          {/* One Schedule chip → the shared SchedulePanel in a popover. The chip label echoes
              the drafted schedule ("07-11 3:00 PM · weekly") once one exists. */}
          <ChipPopover
            label={scheduleSummary(due, dueTime, recurring, ongoing) ?? 'Schedule'}
            icon="📅"
            active={due != null || recurring != null || ongoing}
            open={scheduleOpen}
            onToggle={() => setScheduleOpen((o) => !o)}
            onClose={() => setScheduleOpen(false)}
          >
            {() => (
              <div className="w-[280px]">
                <SchedulePanel
                  taskText={text.trim() || 'New task'}
                  due={due}
                  dueTime={dueTime}
                  recurring={recurring}
                  ongoing={ongoing}
                  timeZone={timeZone}
                  onSetDue={(d, t) => {
                    setDue(d)
                    setDueTime(t)
                  }}
                  onSetRecurring={(n) => {
                    setOngoing(false)
                    setRecurring({ frequencyDays: n, lastDoneAt: null, doneCount: 0 })
                  }}
                  onSetFrequency={(n) =>
                    setRecurring((r) =>
                      r
                        ? { ...r, frequencyDays: n }
                        : { frequencyDays: n, lastDoneAt: null, doneCount: 0 },
                    )
                  }
                  onRemoveRecurring={() => setRecurring(null)}
                  onSetOngoing={(on) => {
                    setOngoing(on)
                    if (on) setRecurring(null)
                  }}
                  reminderOffsets={reminderMinutes}
                  onToggleReminder={(m) =>
                    setReminderMinutes((cur) =>
                      cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m],
                    )
                  }
                  onClearReminders={() => setReminderMinutes([])}
                  idPrefix="add"
                />
              </div>
            )}
          </ChipPopover>
          <button
            type="submit"
            disabled={addTask.isPending || !text.trim()}
            className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}
    </div>
  )
}

// A compact chip that toggles a small popover. Shared shell for Due / Repeat. Controlled by the
// parent (single-open) so it stays a dumb presentational shell; dismissal (outside-click + Esc)
// lives here since every instance wants it.
function ChipPopover({
  label,
  icon,
  active,
  open,
  onToggle,
  onClose,
  children,
}: {
  label: string
  icon: string
  active: boolean
  open: boolean
  onToggle: () => void
  onClose: () => void
  children: (close: () => void) => React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The ref wraps trigger + panel, so a click on the trigger reads as "inside" and its onClick
  // owns the toggle without this also firing (which would double-close).
  useClickOutside(ref, onClose, open)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={
          'flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] transition-colors ' +
          (active || open
            ? 'border-primary bg-primary/5 text-ink'
            : 'border-border-strong text-muted hover:border-muted-faint hover:text-ink')
        }
      >
        <span aria-hidden>{icon}</span>
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 min-w-max rounded-xl border border-border-strong bg-card p-3 shadow-xl ring-1 ring-black/5">
          {children(onClose)}
        </div>
      )}
    </div>
  )
}

// --- BabyClaw mode -----------------------------------------------------------------------
// Text color per derived tone — the sub-line reads as "working / done / needs-info / error" at a
// glance without opening the chat drawer.
const TONE_CLASS: Record<BabyClawTone, string> = {
  idle: 'text-muted',
  busy: 'text-primary',
  pending: 'text-accent',
  done: 'text-primary',
  error: 'text-accent',
  paused: 'text-muted',
}

function BabyClawInput({
  chat,
  status,
  onOpenChat,
}: {
  chat: ChatController
  status: BabyClawStatus
  onOpenChat: () => void
}) {
  const [text, setText] = useState('')
  const { send, busy, paused, pending, liveItems, confirm, deny } = chat

  // Transient "what just happened" chip: flash the newest tool outcome for ~2s, then let it fall
  // back to the resting status line. Keyed on the newest tool item's id so it fires once per
  // completed action. Reads liveItems (this visit) so a hydrated history line never flashes.
  const lastTool = useMemo(
    () => [...liveItems].reverse().find((i) => i.role === 'tool'),
    [liveItems],
  )
  const flashId = lastTool?.id
  const flashOk = lastTool?.ok !== false
  const flashVerb = lastTool ? toolVerb(lastTool.text) : ''
  const [flash, setFlash] = useState<{ ok: boolean; verb: string } | null>(null)
  const seenTool = useRef(flashId) // seed with mount-time history so old results don't flash
  useEffect(() => {
    if (!flashId || flashId === seenTool.current) return
    seenTool.current = flashId
    setFlash({ ok: flashOk, verb: flashVerb })
    const t = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(t)
  }, [flashId, flashOk, flashVerb])

  function handleSend(e: FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || busy) return
    send(trimmed)
    setText('')
    setFlash(null) // clear any prior chip so it doesn't linger over the new "Working…" line
  }

  // While a confirmation is pending, a typed reply answers it (yes runs it, anything else
  // declines) — same conversation as the Yes/No buttons below and the drawer's Confirm/Cancel.
  const placeholder = pending
    ? 'Yes or no — or say what to do instead…'
    : status.waiting
      ? 'Type your answer to BabyClaw…'
      : 'Tell BabyClaw what to add, change, or check off…'

  return (
    <div className="flex min-w-[220px] flex-1 flex-col gap-1">
      <form onSubmit={handleSend} className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label="Tell BabyClaw"
          disabled={paused}
          className={
            'min-w-0 flex-1 rounded-lg border bg-card px-3 py-1.5 text-sm focus:outline-none disabled:opacity-50 ' +
            (status.waiting
              ? 'border-accent/60 focus:border-accent'
              : 'border-border-strong focus:border-puppy')
          }
        />
        <button
          type="submit"
          disabled={busy || paused || !text.trim()}
          className="rounded-lg bg-ink px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Send
        </button>
      </form>

      {status.waiting ? (
        // The unmissable "stopped on you" strip. role=status so the question is announced the
        // moment BabyClaw asks it, without stealing focus from wherever the user is typing.
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-accent/40 px-2.5 py-1.5"
          style={{ backgroundColor: 'rgba(194, 105, 63, 0.07)' }}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink">
              <span aria-hidden className="mr-1 select-none">
                🐾
              </span>
              <span className="font-semibold text-accent">BabyClaw is waiting on your reply:</span>{' '}
              {status.text}
            </p>
            {pending && (
              <span className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={confirm}
                  className="rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-white hover:opacity-90"
                >
                  Yes, go ahead
                </button>
                <button
                  type="button"
                  onClick={deny}
                  className="rounded-full border border-border-strong bg-card px-3 py-1 text-[11px] text-ink hover:border-ink"
                >
                  No
                </button>
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted">
            He won’t do anything until you answer — reply in the box above
            {pending ? ', tap a button,' : ''} or{' '}
            <button type="button" onClick={onOpenChat} className="underline hover:text-ink">
              open the full chat
            </button>
            .
          </p>
        </div>
      ) : (
        // One derived line reflecting BabyClaw's current state (busy / done ✓ / error ✕ / idle
        // hint — see babyclaw-status.ts), always signed with his name so it's obvious who's
        // talking in this little window.
        <div className="flex items-center gap-1.5 px-1 text-[11px]">
          <span className="flex shrink-0 items-center gap-1 font-medium text-ink/75">
            <span aria-hidden className="select-none text-[10px]">
              🐾
            </span>
            BabyClaw
          </span>
          <span aria-hidden className="text-muted-faint">
            ·
          </span>
          <span
            aria-hidden
            className={`${TONE_CLASS[status.tone]} ${status.tone === 'busy' ? 'thinking-sparkle' : ''}`}
          >
            {status.icon}
          </span>
          <span
            className={`min-w-0 flex-1 truncate ${TONE_CLASS[status.tone]}`}
            aria-live="polite"
            title={status.tone === 'busy' ? undefined : status.text}
          >
            {status.tone === 'busy' ? (
              <>
                Working
                <PawSteps />
              </>
            ) : (
              status.text
            )}
          </span>
          {flash && (
            <span
              className={
                'shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium ' +
                (flash.ok ? 'text-primary' : 'text-accent')
              }
              style={{
                // Faint tint behind the chip. Tailwind opacity modifiers aren't used in this codebase
                // (it sets translucent colors inline — see index.css), so do the same here.
                animation: 'babyclaw-flash 220ms ease-out',
                backgroundColor: flash.ok ? 'rgba(91, 138, 114, 0.12)' : 'rgba(194, 105, 63, 0.12)',
              }}
            >
              {flash.ok ? `${flash.verb} ✓` : 'error ✕'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
