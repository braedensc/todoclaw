import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import type { Task } from '../../types/task'
import { quadrantMeta } from '../../lib/quadrants'
import { RC_COLOR, recurringStatus, fmtFrequency } from '../../lib/recurring'
import { CARD_WIDTH, RECURRING_BADGE_MIN_DONE } from './grid-constants'

export interface GridCardProps {
  task: Task
  /** Screen-space coordinates 0..1 (already y-inverted by the caller). */
  screenX: number
  screenY: number
  /** True while this card is the one being dragged (so we can suppress its transition). */
  dragging: boolean
  /** Pointer-down handler from useFreeDrag.startDrag(task.id) — begins a reposition drag. */
  onPointerDown: (event: PointerEvent) => void
  onRename: (text: string) => void
  onDelete: () => void
  onBackToTray: () => void
}

/**
 * A single placed task card on the grid. The 3px top border encodes status: a recurring
 * task uses its RC_COLOR (overdue/due/soon/ok), otherwise the quadrant color for its (x,y).
 * Hover reveals edit / delete / back-to-tray. The whole card is the drag handle; the action
 * buttons stopPropagation so clicking them never starts a drag. "Mark done" is intentionally
 * absent here — it needs the Done data-layer RPC and lands in a later PR.
 */
export function GridCard({
  task,
  screenX,
  screenY,
  dragging,
  onPointerDown,
  onRename,
  onDelete,
  onBackToTray,
}: GridCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.text)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  // x/y are guaranteed non-null by the caller's filter, but be defensive for the type.
  const rc = recurringStatus(task.recurring)
  const borderColor = rc ? RC_COLOR[rc.code] : quadrantMeta(task.x ?? 0.5, task.y ?? 0.5).color

  const showBadge = task.recurring != null && task.recurring.doneCount >= RECURRING_BADGE_MIN_DONE

  const style: CSSProperties = {
    left: `${screenX * 100}%`,
    top: `${screenY * 100}%`,
    width: CARD_WIDTH,
    transform: 'translate(-50%, -50%)',
    borderTopColor: borderColor,
    touchAction: 'none',
    transition: dragging ? 'none' : 'box-shadow 120ms ease',
  }

  function commitRename(): void {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== task.text) onRename(trimmed)
    setEditing(false)
  }

  return (
    <div
      data-testid="grid-card"
      data-task-id={task.id}
      onPointerDown={editing ? undefined : onPointerDown}
      className="group absolute cursor-grab rounded-lg border border-border bg-card text-xs text-ink shadow-sm hover:z-10 hover:shadow-md active:cursor-grabbing"
      style={{ ...style, borderTopWidth: 3, padding: '6px 8px 5px' }}
    >
      {/* Recurring status badge (mirrors EisenClaw's overdue/due/soon line). */}
      {rc && (
        <div className="mb-1 flex items-center gap-1">
          <span
            className="rounded px-1 py-0.5 text-[10px] font-semibold uppercase text-white"
            style={{ backgroundColor: RC_COLOR[rc.code] }}
          >
            ↻ {rc.label}
          </span>
          {task.recurring && (
            <span className="text-[10px] text-muted">
              {fmtFrequency(task.recurring.frequencyDays)}
            </span>
          )}
          {showBadge && (
            <span className="ml-auto text-[10px] font-semibold text-muted">
              ×{task.recurring?.doneCount}
            </span>
          )}
        </div>
      )}

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          aria-label="Edit task"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') {
              setDraft(task.text)
              setEditing(false)
            }
          }}
          // Editing must not start a drag; the input owns its own pointer events.
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full rounded border border-border-strong bg-card px-1 py-0.5 text-xs"
        />
      ) : (
        <p className="break-words leading-snug">{task.text}</p>
      )}

      {/* Hover action buttons — hidden until hover; each stops propagation so it isn't a drag. */}
      {!editing && (
        <div className="absolute -top-2 right-1 hidden gap-1 group-hover:flex">
          <ActionButton
            label="Edit task"
            onClick={() => {
              setDraft(task.text)
              setEditing(true)
            }}
          >
            ✎
          </ActionButton>
          <ActionButton label="Back to tray" onClick={onBackToTray}>
            ⤓
          </ActionButton>
          <ActionButton label="Delete task" onClick={onDelete}>
            ×
          </ActionButton>
        </div>
      )}
    </div>
  )
}

interface ActionButtonProps {
  label: string
  onClick: () => void
  children: React.ReactNode
}

// A hover action. Stops pointer/click propagation so it never starts a card drag.
function ActionButton({ label, onClick, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="flex h-5 w-5 items-center justify-center rounded border border-border-strong bg-card text-xs leading-none text-muted shadow-sm hover:bg-panel hover:text-ink"
    >
      {children}
    </button>
  )
}
