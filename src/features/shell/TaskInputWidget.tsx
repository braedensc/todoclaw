import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useAddTask } from '../tasks/use-tasks'
import { StagingBar } from '../grid/StagingBar'
import { useClickOutside } from '../../hooks/use-click-outside'
import type { GridApi } from '../grid/use-grid'
import type { ChatController } from '../ai/use-chat-controller'

// The one slim input widget above the grid (B8, items 4/5/7/9). A Manual ⇄ BabyClaw pill toggle
// swaps between two modes that share the row:
//  - MANUAL: "manually add task…" + Due + Repeat + Add, with the staging chips folded in below.
//    Staging is Manual-ONLY.
//  - BABYCLAW: a natural-language box routed through the EXISTING chat backend (the shared
//    ChatController). After sending it shows ONLY the latest reply inline; full history opens in
//    the chat popup via "Open chat".
// It replaces the old header add-form, the standalone Chat button, AND the right-column tray.

type Mode = 'manual' | 'babyclaw'

interface TaskInputWidgetProps {
  grid: GridApi
  chat: ChatController
  /** True when the Grid canvas is mounted (Grid view) — staging chips are placeable only then. */
  canPlace: boolean
  /** Open the full chat-history popup (BabyClaw "Open chat"). */
  onOpenChat: () => void
}

export function TaskInputWidget({ grid, chat, canPlace, onOpenChat }: TaskInputWidgetProps) {
  const [mode, setMode] = useState<Mode>('manual')

  return (
    <div className="rounded-[10px] border border-border bg-card p-2">
      <div className="flex flex-wrap items-center gap-2">
        <ModeToggle mode={mode} onSelect={setMode} />
        {mode === 'manual' ? (
          <ManualInput />
        ) : (
          <BabyClawInput chat={chat} onOpenChat={onOpenChat} />
        )}
      </div>

      {mode === 'manual' && <StagingBar grid={grid} canPlace={canPlace} />}
    </div>
  )
}

// --- Mode toggle -------------------------------------------------------------------------
function ModeToggle({ mode, onSelect }: { mode: Mode; onSelect: (m: Mode) => void }) {
  return (
    <div
      role="group"
      aria-label="Add mode"
      className="inline-flex shrink-0 items-center rounded-full border border-border-strong bg-bg p-0.5"
    >
      {(
        [
          { id: 'manual', label: 'Manual', icon: '✎' },
          { id: 'babyclaw', label: 'BabyClaw', icon: '✦' },
        ] as const
      ).map((m) => {
        const active = m.id === mode
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            aria-pressed={active}
            className={
              'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ' +
              (active
                ? 'bg-card text-ink shadow-sm ring-1 ring-border-strong'
                : 'text-muted hover:text-ink')
            }
          >
            <span aria-hidden>{m.icon}</span>
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

// --- Manual mode -------------------------------------------------------------------------
type ChipId = 'due' | 'repeat'

function ManualInput() {
  const addTask = useAddTask()
  const [text, setText] = useState('')
  const [due, setDue] = useState<string | null>(null)
  const [repeatDays, setRepeatDays] = useState<number | null>(null)
  // Which chip popover is open — a single value enforces one-open-at-a-time (opening one
  // closes the other). `null` = both closed.
  const [openChip, setOpenChip] = useState<ChipId | null>(null)
  const toggleChip = (id: ChipId) => setOpenChip((cur) => (cur === id ? null : id))
  const closeChips = () => setOpenChip(null)

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    addTask.mutate(
      {
        text: trimmed,
        due,
        recurring: repeatDays
          ? { frequencyDays: repeatDays, lastDoneAt: null, doneCount: 0 }
          : null,
      },
      {
        onSuccess: () => {
          setText('')
          setDue(null)
          setRepeatDays(null)
        },
      },
    )
  }

  return (
    <form onSubmit={handleAdd} className="flex min-w-[220px] flex-1 flex-wrap items-center gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="manually add task…"
        aria-label="Add a task"
        className="min-w-0 flex-1 rounded-lg border border-border-strong bg-card px-3 py-1.5 text-sm"
      />
      <DueControl
        value={due}
        onChange={setDue}
        open={openChip === 'due'}
        onToggle={() => toggleChip('due')}
        onClose={closeChips}
      />
      <RepeatControl
        value={repeatDays}
        onChange={setRepeatDays}
        open={openChip === 'repeat'}
        onToggle={() => toggleChip('repeat')}
        onClose={closeChips}
      />
      <button
        type="submit"
        disabled={addTask.isPending || !text.trim()}
        className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        Add
      </button>
    </form>
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

interface ChipControlProps {
  open: boolean
  onToggle: () => void
  onClose: () => void
}

function DueControl({
  value,
  onChange,
  open,
  onToggle,
  onClose,
}: ChipControlProps & {
  value: string | null
  onChange: (v: string | null) => void
}) {
  const label = value ? value.slice(5) : 'Due' // MM-DD, compact
  return (
    <ChipPopover
      label={label}
      icon="📅"
      active={value != null}
      open={open}
      onToggle={onToggle}
      onClose={onClose}
    >
      {(close) => (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">
            Due date
          </span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Due date"
              value={value ?? ''}
              onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
              className="rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-sm text-ink focus:border-primary focus:outline-none"
            />
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  close()
                }}
                className="rounded-md border border-border-strong px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-muted-faint hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </ChipPopover>
  )
}

function RepeatControl({
  value,
  onChange,
  open,
  onToggle,
  onClose,
}: ChipControlProps & {
  value: number | null
  onChange: (v: number | null) => void
}) {
  const [draft, setDraft] = useState('')
  const [wasOpen, setWasOpen] = useState(open)
  const label = value ? `every ${value}d` : 'Repeat'
  // Seed the input with the current interval each time the popover opens so it reads as an edit
  // of the existing value, not a blank re-entry. Done as a render-phase adjustment on the
  // open→ transition (React's sanctioned alternative to a setState-in-effect).
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(value ? String(value) : '')
  }
  return (
    <ChipPopover
      label={label}
      icon="↻"
      active={value != null}
      open={open}
      onToggle={onToggle}
      onClose={onClose}
    >
      {(close) => (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">
            Repeat
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">every</span>
            <input
              type="number"
              min={1}
              max={365}
              placeholder="3"
              aria-label="Repeat every N days"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-14 rounded-md border border-border-strong bg-card px-2 py-1.5 text-center text-sm text-ink focus:border-primary focus:outline-none"
            />
            <span className="text-sm text-muted">days</span>
            <button
              type="button"
              onClick={() => {
                const n = Number(draft)
                if (Number.isFinite(n) && n >= 1) onChange(Math.floor(n))
                close()
              }}
              className="rounded-md border border-primary px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              Set
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  setDraft('')
                  close()
                }}
                className="rounded-md border border-border-strong px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-muted-faint hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </ChipPopover>
  )
}

// --- BabyClaw mode -----------------------------------------------------------------------
function BabyClawInput({ chat, onOpenChat }: { chat: ChatController; onOpenChat: () => void }) {
  const [text, setText] = useState('')
  const { send, busy, paused, pending, items } = chat

  // The latest assistant line (the only history shown inline; full history is the popup).
  const lastReply = [...items].reverse().find((i) => i.role === 'assistant')

  function handleSend(e: FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || busy) return
    send(trimmed)
    setText('')
  }

  return (
    <div className="flex min-w-[220px] flex-1 flex-col gap-1">
      <form onSubmit={handleSend} className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tell BabyClaw what to add…"
          aria-label="Tell BabyClaw"
          disabled={paused}
          className="min-w-0 flex-1 rounded-lg border border-border-strong bg-card px-3 py-1.5 text-sm disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || paused || !text.trim()}
          className="rounded-lg bg-ink px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Send
        </button>
      </form>
      <div className="flex items-center justify-between gap-2 px-1 text-[11px]">
        <span className="min-w-0 flex-1 truncate text-primary">
          {paused
            ? 'AI is paused this month — the planner still works without it.'
            : pending
              ? '✦ Needs confirmation — open chat to review.'
              : busy
                ? '✦ Thinking…'
                : lastReply
                  ? `✦ ${lastReply.text}`
                  : 'Add tasks in plain language — e.g. “call landlord, urgent”.'}
        </span>
        <button
          type="button"
          onClick={onOpenChat}
          className="shrink-0 whitespace-nowrap text-muted hover:text-ink"
        >
          Open chat <span aria-hidden>↗</span>
        </button>
      </div>
    </div>
  )
}
