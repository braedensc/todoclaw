import type { CSSProperties, PointerEvent } from 'react'
import type { Task } from '../../types/task'
import { quadrantMeta } from '../../lib/quadrants'
import { RC_COLOR, recurringStatus } from '../../lib/recurring'
import { daysUntil } from '../../lib/scoring'
import {
  CLUSTER_POPUP_FLIP_Y,
  CLUSTER_POPUP_MAX_HEIGHT,
  CLUSTER_POPUP_WIDTH,
} from './cluster-constants'

export interface ClusterPopupProps {
  /** The clustered tasks to list (newest-first input order is preserved). */
  group: Task[]
  /** Accent color (from `clusterAccentColor`) for the header. */
  accentColor: string
  /**
   * Dominant task's DATA-space y (importance). The popup flips ABOVE the bubble when this
   * exceeds `CLUSTER_POPUP_FLIP_Y` (html:616-617), else opens below.
   */
  dominantY: number
  /** IANA timezone — feeds the due-date badge (matches the grid's `daysUntil`). */
  timeZone: string
  /** Mark a row done (branches recurring vs normal in the parent). */
  onDone: (task: Task) => void
  /** Edit a row (opens inline rename / list view in the parent). */
  onEdit: (task: Task) => void
  /** Soft-delete a row. */
  onDelete: (task: Task) => void
  /** Pointer-down handler from `useFreeDrag.startDrag(id)` — drags the row out to the grid. */
  onRowPointerDown: (task: Task) => (event: PointerEvent) => void
}

/**
 * The floating panel that opens when a cluster bubble is clicked. Lists each task as a
 * card-style row with: done ✓, text, status badge (recurring ↻ or a due-day chip), edit ↗,
 * delete ×. Pressing-and-dragging a row pulls that task out of the cluster and drops it
 * freely on the grid. Ported from EisenClaw (html:616-639).
 */
export function ClusterPopup({
  group,
  accentColor,
  dominantY,
  timeZone,
  onDone,
  onEdit,
  onDelete,
  onRowPointerDown,
}: ClusterPopupProps) {
  // data-y > 0.55 → bubble is high on the (y-inverted) screen → anchor the panel above it.
  const flipAbove = dominantY > CLUSTER_POPUP_FLIP_Y

  const style: CSSProperties = {
    width: CLUSTER_POPUP_WIDTH,
    maxHeight: CLUSTER_POPUP_MAX_HEIGHT,
    left: '50%',
    transform: 'translateX(-50%)',
    ...(flipAbove ? { bottom: 'calc(100% + 8px)' } : { top: 'calc(100% + 8px)' }),
    zIndex: 70,
  }

  return (
    <div
      data-testid="cluster-popup"
      role="dialog"
      aria-label={`${group.length} clustered tasks`}
      className="absolute overflow-y-auto rounded-xl border border-border bg-panel shadow-[0_8px_28px_rgba(0,0,0,.18)]"
      style={style}
      // Clicks inside the popup must not bubble to the grid background (which closes it).
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: accentColor }}
      >
        {group.length} tasks here
      </div>

      {group.map((task) => (
        <ClusterPopupRow
          key={task.id}
          task={task}
          timeZone={timeZone}
          onDone={() => onDone(task)}
          onEdit={() => onEdit(task)}
          onDelete={() => onDelete(task)}
          onPointerDown={onRowPointerDown(task)}
        />
      ))}
    </div>
  )
}

interface ClusterPopupRowProps {
  task: Task
  timeZone: string
  onDone: () => void
  onEdit: () => void
  onDelete: () => void
  onPointerDown: (event: PointerEvent) => void
}

// One card-style task row. The whole row is a drag handle (press-drag pulls the task out of
// the cluster); each action button stops propagation so a click never starts a drag.
function ClusterPopupRow({
  task,
  timeZone,
  onDone,
  onEdit,
  onDelete,
  onPointerDown,
}: ClusterPopupRowProps) {
  const rc = recurringStatus(task.recurring)
  const accent = rc ? RC_COLOR[rc.code] : quadrantMeta(task.x ?? 0.5, task.y ?? 0.5).color
  const d = daysUntil(task.due, { timeZone })
  const urgent = d !== null && d <= 2

  return (
    <div
      data-testid="cluster-popup-row"
      data-task-id={task.id}
      onPointerDown={onPointerDown}
      className="mx-2 my-1.5 flex cursor-grab items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-ink shadow-sm active:cursor-grabbing"
      style={{ borderLeft: `3px solid ${accent}`, touchAction: 'none' }}
    >
      <RowButton
        label="Mark done"
        onClick={onDone}
        title={task.recurring ? 'Done (resets)' : 'Done'}
      >
        ✓
      </RowButton>

      <span className="min-w-0 flex-1 break-words text-[13px] font-medium leading-snug">
        {task.text}
      </span>

      {/* Status chip: recurring marker, or a due-day chip for dated one-offs. */}
      {rc ? (
        <span
          className="flex-shrink-0 rounded px-1 text-[9px] font-semibold text-white"
          style={{ backgroundColor: RC_COLOR[rc.code] }}
          title={rc.label}
        >
          ↻
        </span>
      ) : (
        d !== null && (
          <span
            className="flex-shrink-0 rounded px-1 text-[9px] font-semibold text-white"
            style={{ backgroundColor: urgent ? '#c2693f' : '#8a8577' }}
          >
            {d < 0 ? '!' : d === 0 ? 'now' : `${d}d`}
          </span>
        )
      )}

      <RowButton label="Edit task" onClick={onEdit}>
        ↗
      </RowButton>
      <RowButton label="Delete task" onClick={onDelete}>
        ×
      </RowButton>
    </div>
  )
}

interface RowButtonProps {
  label: string
  title?: string
  onClick: () => void
  children: React.ReactNode
}

// A row action. Stops pointer/click propagation so it never starts the row's drag-out.
function RowButton({ label, title, onClick, children }: RowButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="flex-shrink-0 px-0.5 text-[13px] leading-none text-muted hover:text-ink"
    >
      {children}
    </button>
  )
}
