import type { Task } from '../../types/task'
import { BottomSheet } from '../../components/BottomSheet'
import { quadrantMeta } from '../../lib/quadrants'
import { RC_COLOR, recurringStatus } from '../../lib/recurring'
import { daysUntil } from '../../lib/scoring'
import {
  dueChipStyle,
  gridChipLabel,
  staleBadge,
  staleChipStyle,
  staleness,
  urgencyTier,
} from '../../lib/visual-urgency'

export interface TouchClusterSheetProps {
  /** The open cluster's members (length > 1), or null (sheet closed). */
  group: readonly Task[] | null
  timeZone: string
  onClose: () => void
  /** Open one member's action sheet (the caller closes this sheet first). */
  onPick: (task: Task) => void
}

/**
 * The touch grid's cluster popup: tap a cluster bubble and its members list here as thumb-sized
 * rows; picking one opens the regular TouchTaskSheet for it, so every member has the full action
 * set without cramming controls into the list. (The desktop ClusterPopup's dense card-twin rows
 * + tear-out drag stay desktop-only — its tap recognizer lives inside the drag machinery.)
 */
export function TouchClusterSheet({ group, timeZone, onClose, onPick }: TouchClusterSheetProps) {
  if (!group) return null
  return (
    <BottomSheet open onClose={onClose} title={`${group.length} tasks here`}>
      <div className="flex max-h-[60dvh] flex-col gap-1.5 overflow-y-auto overscroll-contain">
        {group.map((task) => {
          // Same lane gating as every sibling surface (TouchGridChip / TouchTaskSheet /
          // GridCard / desktop ClusterPopup rows): staleness gates the warm tier so a row can
          // never contradict the chip and sheet it opens into. (No paused branch: dormant tasks
          // never reach clusters.)
          const rc = recurringStatus(task.recurring)
          const d = daysUntil(task.due, { timeZone })
          const stale = rc ? null : staleness(task, d)
          const frost = stale ? staleBadge(stale) : null
          const tier = rc || stale ? 'none' : urgencyTier(d, null)
          const topColor = rc ? RC_COLOR[rc.code] : quadrantMeta(task.x ?? 0.5, task.y ?? 0.5).color
          return (
            <button
              key={task.id}
              type="button"
              data-task-id={task.id}
              onClick={() => onPick(task)}
              className="flex min-h-[52px] items-center gap-2.5 rounded-lg border border-border bg-card px-3 text-left"
              style={{ borderLeft: `4px solid ${topColor}` }}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {rc && (
                  <span aria-hidden className="mr-1" style={{ color: RC_COLOR[rc.code] }}>
                    ↻
                  </span>
                )}
                {task.text}
              </span>
              {rc ? (
                <span
                  className="shrink-0 text-xs font-semibold"
                  style={{ color: RC_COLOR[rc.code] }}
                >
                  {rc.label}
                </span>
              ) : frost ? (
                <span
                  title={frost.title}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  style={staleChipStyle()}
                >
                  {frost.chip}
                </span>
              ) : tier !== 'none' && d !== null ? (
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  style={dueChipStyle(tier)}
                >
                  {gridChipLabel(tier, d, task.due_time, null)}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </BottomSheet>
  )
}
