import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import type { Task } from '../../types/task'
import { quadrantMeta } from '../../lib/quadrants'
import { RC_COLOR, recurringStatus, fmtFrequency } from '../../lib/recurring'
import {
  DUE_BADGE_MUTED,
  DUE_BADGE_URGENT,
  stalenessStyle,
  urgencyGlowStyle,
} from '../../lib/visual-urgency'
import { CARD_WIDTH, RECURRING_BADGE_MIN_DONE } from './grid-constants'

export interface GridCardProps {
  task: Task
  /** Screen-space coordinates 0..1 (already y-inverted by the caller). */
  screenX: number
  screenY: number
  /**
   * Whole calendar days until this task's due date (from `daysUntil`, timezone-aware), or null
   * when it has no due date. Drives the urgency glow + the due badge. Computed by the caller so
   * the timezone lives in one place (GridView) rather than being threaded into every card.
   */
  daysUntilDue: number | null
  /** True while this card is the one being dragged (so we can suppress its transition). */
  dragging: boolean
  /** Pointer-down handler from useFreeDrag.startDrag(task.id) — begins a reposition drag. */
  onPointerDown: (event: PointerEvent) => void
  onRename: (text: string) => void
  onDelete: () => void
  onBackToTray: () => void
  /** Mark this task done — caller branches recurring (reset cycle) vs normal (write history). */
  onDone: () => void
}

/**
 * A single placed task card on the grid. The 3px top border encodes status: a recurring
 * task uses its RC_COLOR (overdue/due/soon/ok), otherwise the quadrant color for its (x,y).
 * Hover reveals done / edit / delete / back-to-tray. The whole card is the drag handle; the
 * action buttons stopPropagation so clicking them never starts a drag. Done marks a normal
 * task complete for today (it leaves the grid) or resets a recurring task's cycle.
 */
export function GridCard({
  task,
  screenX,
  screenY,
  daysUntilDue,
  dragging,
  onPointerDown,
  onRename,
  onDelete,
  onBackToTray,
  onDone,
}: GridCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.text)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  // x/y are guaranteed non-null by the caller's filter, but be defensive for the type.
  const rc = recurringStatus(task.recurring)
  // Data-space quadrant for this card's (x, y). Drives the border color (when not recurring)
  // and a `data-quadrant` hook so E2E specs can assert placement without reading pixel styles
  // (durable across Stage 5's restyle).
  const quadrant = quadrantMeta(task.x ?? 0.5, task.y ?? 0.5)
  const borderColor = rc ? RC_COLOR[rc.code] : quadrant.color

  const showBadge = task.recurring != null && task.recurring.doneCount >= RECURRING_BADGE_MIN_DONE

  // Urgency glow + staleness dust apply only to non-recurring cards (a recurring task carries its
  // own RC_COLOR status; done tasks never reach the grid). See lib/visual-urgency.
  const glow = rc ? null : urgencyGlowStyle(daysUntilDue)
  const stale = rc ? null : stalenessStyle(task)

  const style: CSSProperties = {
    left: `${screenX * 100}%`,
    top: `${screenY * 100}%`,
    width: CARD_WIDTH,
    transform: 'translate(-50%, -50%)',
    borderTopColor: borderColor,
    touchAction: 'none',
    transition: dragging ? 'none' : 'box-shadow 120ms ease',
    // Glow overrides the resting shadow (its string carries its own drop-shadow layer). Overdue
    // cards also get the pulse animation; the keyframe is global (src/index.css). `animation` is
    // spread only when present so a future base animation on this card can't be clobbered.
    ...(glow
      ? { boxShadow: glow.boxShadow, ...(glow.animation ? { animation: glow.animation } : {}) }
      : {}),
    ...(stale ? { filter: stale.filter, opacity: stale.opacity } : {}),
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
      data-quadrant={quadrant.key}
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

      {/* Non-recurring due badge — the textual half of the urgency layer (html:590). Terracotta
          when due within 2 days, muted grey otherwise. Recurring cards show their status badge
          above instead, so this is suppressed when `rc` is set. */}
      {!editing && !rc && daysUntilDue !== null && (
        <span
          className="mt-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold text-white"
          style={{ backgroundColor: daysUntilDue <= 2 ? DUE_BADGE_URGENT : DUE_BADGE_MUTED }}
        >
          {daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'today' : `${daysUntilDue}d`}
        </span>
      )}

      {/* Hover action buttons — hidden until hover; each stops propagation so it isn't a drag. */}
      {!editing && (
        <div className="absolute -top-2 right-1 hidden gap-1 group-hover:flex">
          <ActionButton label={task.recurring ? 'Done (resets cycle)' : 'Done'} onClick={onDone}>
            ✓
          </ActionButton>
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
