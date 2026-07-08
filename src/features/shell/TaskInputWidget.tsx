import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useAddTask } from '../tasks/use-tasks'
import { useClickOutside } from '../../hooks/use-click-outside'
import type { GridApi } from '../grid/use-grid'
import { NewItemStrip } from './NewItemStrip'
import type { ChatController } from '../ai/use-chat-controller'
import { deriveBabyClawStatus, toolVerb } from './babyclaw-status'
import type { BabyClawTone } from './babyclaw-status'
import { PawSteps } from '../../components/Thinking'

// The one slim input widget above the grid (B8, items 4/5/7/9). A Manual ⇄ BabyClaw pill toggle
// swaps between two modes that share the row:
//  - MANUAL: "manually add task…" + Due + Repeat + Add. A just-added task materializes IN PLACE
//    as a draggable "Drag new item to grid" card (B2) that replaces the input; drag it onto the
//    grid and the input returns. No staging tray.
//  - BABYCLAW: a natural-language box routed through the EXISTING chat backend (the shared
//    ChatController). After sending it shows ONLY the latest reply inline; full history opens in
//    the chat drawer via "Open chat".
// It replaces the old header add-form, the standalone Chat button, AND the right-column tray.

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

  return (
    // On BabyClaw's side the whole widget picks up a whisper of his slate-blue — a tinted
    // border, a one-hairline ring, and a wash fading down from the top edge. Inline (not
    // Tailwind opacity modifiers) to match how this file already does translucent color, and
    // within STYLE.md's rule for the `puppy` token: BabyClaw-mode accents only. Manual mode
    // drops back to the plain warm-paper widget.
    <div
      className="rounded-[10px] border border-border bg-card p-2 transition-[border-color,box-shadow] duration-300"
      style={
        mode === 'babyclaw'
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
        <ModeToggle mode={mode} onSelect={setMode} />
        {mode === 'manual' ? (
          <ManualInput grid={grid} canPlace={canPlace} />
        ) : (
          <BabyClawInput chat={chat} onOpenChat={onOpenChat} />
        )}
      </div>
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
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            aria-pressed={active}
            className={
              'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ' +
              (active
                ? `bg-card text-ink shadow-sm ring-1 ${activeRing}`
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

function ManualInput({ grid, canPlace }: { grid: GridApi; canPlace: boolean }) {
  const addTask = useAddTask()
  const [text, setText] = useState('')
  const [due, setDue] = useState<string | null>(null)
  const [repeatDays, setRepeatDays] = useState<number | null>(null)
  // Which chip popover is open — a single value enforces one-open-at-a-time (opening one
  // closes the other). `null` = both closed.
  const [openChip, setOpenChip] = useState<ChipId | null>(null)
  const toggleChip = (id: ChipId) => setOpenChip((cur) => (cur === id ? null : id))
  const closeChips = () => setOpenChip(null)

  // Card-in-place (B2): a just-added task surfaces as a draggable card that REPLACES the input
  // (the pending strip below). One todo at a time — the input stays hidden until the pending card
  // is dragged onto the grid, then it returns for the next add.
  const pending = grid.pendingTasks
  const showForm = pending.length === 0

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

// Exported so the mobile add sheet (MobileAddSheet) can reuse the exact BabyClaw capture UI.
export function BabyClawInput({
  chat,
  onOpenChat,
}: {
  chat: ChatController
  onOpenChat: () => void
}) {
  const [text, setText] = useState('')
  const { send, busy, paused, pending, error, items } = chat

  // One derived line reflecting BabyClaw's current state (busy / needs-confirmation / done ✓ /
  // error ✕ / a follow-up question / idle) — see babyclaw-status.ts.
  const status = deriveBabyClawStatus({ paused, busy, pending, error, items })

  // Transient "what just happened" chip: flash the newest tool outcome for ~2s, then let it fall
  // back to the resting status line. Keyed on the newest tool item's id so it fires once per
  // completed action and not for history already present when BabyClaw mode mounts.
  const lastTool = useMemo(() => [...items].reverse().find((i) => i.role === 'tool'), [items])
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

  return (
    <div className="flex min-w-[220px] flex-1 flex-col gap-1">
      <form onSubmit={handleSend} className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          // While a confirmation is pending, a typed reply answers it (yes runs it, anything
          // else declines) — same conversation as the drawer's Confirm/Cancel buttons.
          placeholder={pending ? 'Yes or no?' : 'Tell BabyClaw what to add…'}
          aria-label="Tell BabyClaw"
          disabled={paused}
          className="min-w-0 flex-1 rounded-lg border border-border-strong bg-card px-3 py-1.5 text-sm focus:border-puppy focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || paused || !text.trim()}
          className="rounded-lg bg-ink px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Send
        </button>
      </form>
      <div className="flex items-center gap-2 px-1 text-[11px]">
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
