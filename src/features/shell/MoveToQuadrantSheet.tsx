import type { Task } from '../../types/task'
import { quadrantMeta, type QuadrantKey } from '../../lib/quadrants'
import { QUADRANT_ORDER, QUADRANT_CENTER, QUADRANT_SUBTITLE } from '../../lib/quadrant-summary'
import { QUADRANT_TINT } from '../grid/grid-constants'
import { BottomSheet } from '../../components/BottomSheet'

// MoveToQuadrantSheet — the tap-based reposition picker for mobile (Concept C, ADR-0025). Replaces
// pixel-dragging: the user picks one of four large quadrant targets and the task snaps to that
// quadrant (band center → collision spiral, in the caller). Inherently accessible in a way free
// dragging never is. Presentational — the caller (MobileMatrix) owns the coordinate math + write.

// Label + color for a quadrant, from quadrantMeta at its band center.
function display(key: QuadrantKey) {
  const c = QUADRANT_CENTER[key]
  return quadrantMeta(c.x, c.y)
}

export function MoveToQuadrantSheet({
  task,
  currentKey,
  onPick,
  onClose,
}: {
  /** The task being moved; the sheet is open while non-null. */
  task: Task | null
  /** The task's current quadrant — shown as "Current" and not selectable (a no-op move). */
  currentKey: QuadrantKey | null
  onPick: (dest: QuadrantKey) => void
  onClose: () => void
}) {
  return (
    <BottomSheet
      open={task != null}
      onClose={onClose}
      title={task ? `Move “${task.text}”` : 'Move task'}
    >
      <p className="mb-3 text-xs text-muted">Pick a quadrant — no dragging.</p>
      <div className="grid grid-cols-2 gap-2.5">
        {QUADRANT_ORDER.map((key) => {
          const m = display(key)
          const isCurrent = key === currentKey
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              disabled={isCurrent}
              aria-label={`Move to ${m.label}`}
              className="relative flex min-h-[76px] flex-col gap-1 rounded-2xl border border-border-strong p-3 text-left transition-transform active:scale-[0.98] disabled:cursor-default disabled:opacity-55 disabled:active:scale-100"
              style={{ borderLeft: `4px solid ${m.color}`, background: QUADRANT_TINT[key] }}
            >
              <span className="font-serif text-sm font-semibold" style={{ color: m.color }}>
                {m.label}
              </span>
              <span className="text-[11px] text-muted-light">{QUADRANT_SUBTITLE[key]}</span>
              {isCurrent && (
                <span className="absolute right-2 top-2 text-[10px] font-semibold uppercase tracking-wide text-muted-light">
                  Current
                </span>
              )}
            </button>
          )
        })}
      </div>
    </BottomSheet>
  )
}
