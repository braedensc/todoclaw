import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAddTask } from '../tasks/use-tasks'
import { StagingBar } from '../grid/StagingBar'
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
function ManualInput() {
  const addTask = useAddTask()
  const [text, setText] = useState('')
  const [due, setDue] = useState<string | null>(null)
  const [repeatDays, setRepeatDays] = useState<number | null>(null)

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
      <DueControl value={due} onChange={setDue} />
      <RepeatControl value={repeatDays} onChange={setRepeatDays} />
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

// A compact chip that toggles a small popover. Shared shell for Due / Repeat.
function ChipPopover({
  label,
  icon,
  active,
  children,
}: {
  label: string
  icon: string
  active: boolean
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={
          'flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] transition-colors ' +
          (active ? 'border-primary text-ink' : 'border-border-strong text-muted hover:text-ink')
        }
      >
        <span aria-hidden>{icon}</span>
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 rounded-lg border border-border-strong bg-card p-2 shadow-lg">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function DueControl({
  value,
  onChange,
}: {
  value: string | null
  onChange: (v: string | null) => void
}) {
  const label = value ? value.slice(5) : 'Due' // MM-DD, compact
  return (
    <ChipPopover label={label} icon="📅" active={value != null}>
      {(close) => (
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="Due date"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
            className="rounded border border-border-strong bg-card px-2 py-1 text-sm"
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null)
                close()
              }}
              className="rounded border border-border-strong px-2 py-1 text-xs text-muted hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </ChipPopover>
  )
}

function RepeatControl({
  value,
  onChange,
}: {
  value: number | null
  onChange: (v: number | null) => void
}) {
  const [draft, setDraft] = useState('')
  const label = value ? `every ${value}d` : 'Repeat'
  return (
    <ChipPopover label={label} icon="↻" active={value != null}>
      {(close) => (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">every</span>
          <input
            type="number"
            min={1}
            max={365}
            placeholder="days"
            aria-label="Repeat every N days"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-16 rounded border border-border-strong bg-card px-2 py-1 text-center text-sm"
          />
          <button
            type="button"
            onClick={() => {
              const n = Number(draft)
              if (Number.isFinite(n) && n >= 1) onChange(Math.floor(n))
              close()
            }}
            className="rounded border px-2 py-1 text-xs font-semibold text-primary"
            style={{ borderColor: '#5b8a72' }}
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
              className="rounded border border-border-strong px-2 py-1 text-xs text-muted hover:text-ink"
            >
              Clear
            </button>
          )}
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
