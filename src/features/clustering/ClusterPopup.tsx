import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Task } from '../../types/task'
import { quadrantMeta } from '../../lib/quadrants'
import { RC_COLOR, recurringStatus } from '../../lib/recurring'
import { daysUntil } from '../../lib/scoring'
import { DUE_BADGE_MUTED, DUE_BADGE_URGENT } from '../../lib/visual-urgency'
import { CardActionBar } from '../../components/CardActionBar'
import { CLUSTER_POPUP_MAX_HEIGHT, CLUSTER_POPUP_WIDTH } from './cluster-constants'

/** Gap (px) between the bubble and the popup, and min gap from any viewport edge. */
const GAP = 8
const MARGIN = 8

export interface ClusterPopupProps {
  /** The clustered tasks to list (newest-first input order is preserved). */
  group: Task[]
  /** Accent color (from `clusterAccentColor`) for the header. */
  accentColor: string
  /**
   * Ref to the OPEN bubble's positioned wrapper node. The popup is portaled OUT of the grid
   * (which is `overflow-hidden` and would clip it near an edge — item 16) and positioned from this
   * node's live `getBoundingClientRect`, so it renders fully on-screen anywhere, including inside
   * the fullscreen overlay (which scrolls via `overflow-auto`).
   */
  anchorRef: RefObject<HTMLElement | null>
  /**
   * Changes whenever the grid reflows (chat push-drawer, window resize, fullscreen toggle). The
   * anchor moves with the grid but fires no scroll/resize event of its own, so this drives a
   * reposition on every grid size change.
   */
  reflowKey: number
  /** IANA timezone — feeds the due-date badge (matches the grid's `daysUntil`). */
  timeZone: string
  /** Id of the row currently in inline-edit mode (a plain tap opens editing), or null. */
  editingId: string | null
  /** Enter inline-edit mode for a row (the ✎ button; a plain row tap does this in the parent). */
  onStartEdit: (task: Task) => void
  /** Leave inline-edit mode (Escape / commit). */
  onStopEdit: () => void
  /** Commit a renamed row. */
  onRename: (task: Task, text: string) => void
  /** Mark a row done (branches recurring vs normal in the parent). */
  onDone: (task: Task) => void
  /** Delete a row (confirm-gated by the parent). */
  onDelete: (task: Task) => void
  /** Pointer-down handler from `useGrid.startPopupRowDrag` — a real drag pulls the row to the grid. */
  onRowPointerDown: (task: Task) => (event: PointerEvent) => void
}

interface PopupPos {
  left: number
  top?: number
  bottom?: number
  maxHeight: number
}

/**
 * The floating panel that opens when a cluster bubble is clicked. Lists each task as a card-style
 * row that mirrors a grid card: quadrant/recurring accent, a recurring ↻ or due chip, and the SAME
 * shared <CardActionBar> (outlined Done pill + ⋯/×) along the bottom. A plain TAP on a row opens it
 * for inline editing (as does the bar's ⋯); only a real DRAG pulls that task out of the cluster and
 * onto the grid. Portaled to `document.body` so the grid's `overflow-hidden` never clips it, and
 * repositioned from the bubble's live rect on scroll/resize/reflow (item 16). Ported from EisenClaw
 * (html:616-639), reworked for the portal + tap-to-edit behavior.
 */
export function ClusterPopup({
  group,
  accentColor,
  anchorRef,
  reflowKey,
  timeZone,
  editingId,
  onStartEdit,
  onStopEdit,
  onRename,
  onDone,
  onDelete,
  onRowPointerDown,
}: ClusterPopupProps) {
  const [pos, setPos] = useState<PopupPos | null>(null)

  const reposition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Horizontal: centre on the bubble, then keep the whole width on-screen.
    const centerX = rect.left + rect.width / 2
    const left = Math.max(
      MARGIN,
      Math.min(centerX - CLUSTER_POPUP_WIDTH / 2, vw - CLUSTER_POPUP_WIDTH - MARGIN),
    )

    // Vertical: prefer below the bubble; flip above when there's more room there (keep-on-screen).
    // Cap the height to the available space so a long list scrolls internally instead of running
    // off the top/bottom edge.
    const spaceBelow = vh - rect.bottom - GAP - MARGIN
    const spaceAbove = rect.top - GAP - MARGIN
    const flipAbove =
      spaceBelow < Math.min(CLUSTER_POPUP_MAX_HEIGHT, spaceAbove) && spaceAbove > spaceBelow

    if (flipAbove) {
      setPos({
        left,
        bottom: vh - rect.top + GAP,
        maxHeight: Math.max(0, Math.min(CLUSTER_POPUP_MAX_HEIGHT, spaceAbove)),
      })
    } else {
      setPos({
        left,
        top: rect.bottom + GAP,
        maxHeight: Math.max(0, Math.min(CLUSTER_POPUP_MAX_HEIGHT, spaceBelow)),
      })
    }
  }, [anchorRef])

  // Position after mount (a passive effect, so the anchor's ref — set on an ANCESTOR fiber — is
  // attached by the time this runs) and on anything that can move the anchor: window scroll
  // (capture, to catch the fullscreen overlay's own overflow-auto scroll), window resize, grid
  // reflow, and the content-height changes that toggle a row's editor or drop a deleted row.
  useEffect(() => {
    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [reposition, reflowKey, group.length, editingId])

  const style: CSSProperties = {
    position: 'fixed',
    left: pos?.left ?? MARGIN,
    ...(pos?.bottom != null ? { bottom: pos.bottom } : { top: pos?.top ?? MARGIN }),
    width: CLUSTER_POPUP_WIDTH,
    maxHeight: pos?.maxHeight ?? CLUSTER_POPUP_MAX_HEIGHT,
    // Above the fullscreen overlay (z-50) but below the confirm dialog (z-100). Hidden until the
    // first measure so it never flashes at the fallback corner.
    zIndex: 90,
    visibility: pos ? 'visible' : 'hidden',
  }

  return createPortal(
    <div
      data-testid="cluster-popup"
      role="dialog"
      aria-label={`${group.length} clustered tasks`}
      className="overflow-y-auto rounded-xl border border-border bg-panel shadow-[0_8px_28px_rgba(0,0,0,.18)]"
      style={style}
      // Portaled to <body>, but React events still bubble to the bubble (which stops them). Stop
      // clicks/pointer-downs here too so nothing inside can ever reach the grid background (whose
      // pointer-down closes the popup).
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
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
          editing={editingId === task.id}
          onStartEdit={() => onStartEdit(task)}
          onStopEdit={onStopEdit}
          onRename={(text) => onRename(task, text)}
          onDone={() => onDone(task)}
          onDelete={() => onDelete(task)}
          onPointerDown={onRowPointerDown(task)}
        />
      ))}
    </div>,
    document.body,
  )
}

interface ClusterPopupRowProps {
  task: Task
  timeZone: string
  editing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  onRename: (text: string) => void
  onDone: () => void
  onDelete: () => void
  onPointerDown: (event: PointerEvent) => void
}

// One card-style task row, laid out like a mini grid card: the task text (with its status chip) on
// top, then the SHARED <CardActionBar> (outlined Done pill + ⋯/×) at the bottom — the same bar the
// grid card renders, so a folded task reads identically here. A plain tap on the row opens inline
// editing (handled upstream via the drag's onTap); a press-drag pulls the task out of the cluster;
// every bar control stops propagation so a click on it is never read as a drag. Here ⋯ is the edit
// trigger (the popup has no on-row due/recurring menu — tapping the row edits it). Quadrant/recurring
// accent on the left border.
function ClusterPopupRow({
  task,
  timeZone,
  editing,
  onStartEdit,
  onStopEdit,
  onRename,
  onDone,
  onDelete,
  onPointerDown,
}: ClusterPopupRowProps) {
  const rc = recurringStatus(task.recurring)
  const accent = rc ? RC_COLOR[rc.code] : quadrantMeta(task.x ?? 0.5, task.y ?? 0.5).color
  const d = daysUntil(task.due, { timeZone })
  const urgent = d !== null && d <= 2

  // Uncontrolled input (seeded by `defaultValue` when the editor mounts) so entering edit mode
  // needs no draft state — the value is read from the ref on commit. Select-all on mount.
  const inputRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = (): void => {
    const trimmed = (inputRef.current?.value ?? '').trim()
    if (trimmed && trimmed !== task.text) onRename(trimmed)
    onStopEdit()
  }

  return (
    <div
      data-testid="cluster-popup-row"
      data-task-id={task.id}
      // While editing the row is not a drag handle (the input owns its pointer events).
      onPointerDown={editing ? undefined : onPointerDown}
      className={`mx-2 my-1.5 flex flex-col rounded-lg border border-border bg-card px-2.5 py-2 text-ink shadow-sm ${
        editing ? '' : 'cursor-grab active:cursor-grabbing'
      }`}
      style={{ borderLeft: `3px solid ${accent}`, touchAction: 'none' }}
    >
      {editing ? (
        <input
          ref={inputRef}
          defaultValue={task.text}
          aria-label="Edit task name"
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') onStopEdit()
          }}
          // Editing must not start a drag; the input owns its own pointer events.
          onPointerDown={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded border border-border-strong bg-card px-1 py-0.5 text-[13px]"
        />
      ) : (
        <div className="flex items-start gap-1.5">
          <span
            className="min-w-0 flex-1 break-words text-[13px] font-medium leading-snug"
            title="Tap to edit · drag to place on the grid"
          >
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
                style={{ backgroundColor: urgent ? DUE_BADGE_URGENT : DUE_BADGE_MUTED }}
              >
                {d < 0 ? '!' : d === 0 ? 'now' : `${d}d`}
              </span>
            )
          )}
        </div>
      )}

      {/* The same action bar the grid card carries. ⋯ is the edit trigger here (redundant with
          tapping the row, but an explicit affordance); delete is confirm-gated upstream. Hidden
          while renaming inline so it doesn't crowd the input. */}
      {!editing && (
        <CardActionBar
          recurring={task.recurring != null}
          onDone={onDone}
          onMenu={onStartEdit}
          onDelete={onDelete}
          menuLabel="Edit task"
        />
      )}
    </div>
  )
}
