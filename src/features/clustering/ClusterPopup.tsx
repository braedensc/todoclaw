import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Task } from '../../types/task'
import { quadrantMeta } from '../../lib/quadrants'
import { RC_COLOR, recurringStatus } from '../../lib/recurring'
import { daysUntil } from '../../lib/scoring'
import {
  agingRingStyle,
  BASE_CARD_SHADOW,
  dueChipStyle,
  urgencyGlowStyle,
  urgencyIcon,
  urgencyTier,
} from '../../lib/visual-urgency'
import { CardActionBar } from '../../components/CardActionBar'
import { useAnchoredMenu } from '../../hooks/use-anchored-menu'
import { useClickOutside } from '../../hooks/use-click-outside'
import { SchedulePanel } from '../schedule/SchedulePanel'
import { BUCKET_DOT } from '../grid/grid-constants'
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
  /** Id of the row currently in inline-edit mode, or null. Entering edit happens UPSTREAM (a
   *  plain row tap, via useGrid.startPopupRowDrag's onTap) — the popup only reads the state. */
  editingId: string | null
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
  // --- Schedule (the row ⋯ opens the shared SchedulePanel, same as a grid card's ⋯) ---------
  /** Commit a row's due date + time — always both columns (clearing the date clears the time). */
  onSetDue: (task: Task, due: string | null, dueTime: string | null) => void
  /** Set a fresh recurring schedule of N days on a row. */
  onSetRecurring: (task: Task, frequencyDays: number) => void
  /** Change an already-recurring row's cadence (preserves lastDoneAt + doneCount). */
  onSetFrequency: (task: Task, frequencyDays: number) => void
  /** Drop a row's recurring schedule. */
  onRemoveRecurring: (task: Task) => void
  /** Make / adjust a row as an ongoing project (check-in cadence + optional target-end). */
  onSetOngoing: (task: Task, checkInDays: number, targetEnd: string | null) => void
  /** A row's selected reminder offsets (minutes before due) — from the grid's shared query. */
  reminderOffsetsFor: (task: Task) => readonly number[]
  /** Toggle one of a row's reminder lead times on/off. */
  onToggleReminder: (task: Task, minutes: number) => void
  /** Clear every reminder on a row (the Off chip). */
  onClearReminders: (task: Task) => void
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
  onStopEdit,
  onRename,
  onDone,
  onDelete,
  onRowPointerDown,
  onSetDue,
  onSetRecurring,
  onSetFrequency,
  onRemoveRecurring,
  onSetOngoing,
  reminderOffsetsFor,
  onToggleReminder,
  onClearReminders,
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
      // WHITE panel (not the cream bg-panel): the rows inside are dressed as mini grid cards with
      // their own urgency tints/glows, and against cream the whole menu read as one warm blob —
      // white makes each card's color read as the card's, not the menu's (owner feedback 2026-07-09).
      className="overflow-y-auto rounded-xl border border-border bg-white shadow-[0_8px_28px_rgba(0,0,0,.18)]"
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
          onStopEdit={onStopEdit}
          onRename={(text) => onRename(task, text)}
          onDone={() => onDone(task)}
          onDelete={() => onDelete(task)}
          onPointerDown={onRowPointerDown(task)}
          onSetDue={(due, dueTime) => onSetDue(task, due, dueTime)}
          onSetRecurring={(n) => onSetRecurring(task, n)}
          onSetFrequency={(n) => onSetFrequency(task, n)}
          onRemoveRecurring={() => onRemoveRecurring(task)}
          onSetOngoing={(checkInDays, targetEnd) => onSetOngoing(task, checkInDays, targetEnd)}
          reminderOffsets={reminderOffsetsFor(task)}
          onToggleReminder={(m) => onToggleReminder(task, m)}
          onClearReminders={() => onClearReminders(task)}
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
  onStopEdit: () => void
  onRename: (text: string) => void
  onDone: () => void
  onDelete: () => void
  onPointerDown: (event: PointerEvent) => void
  onSetDue: (due: string | null, dueTime: string | null) => void
  onSetRecurring: (frequencyDays: number) => void
  onSetFrequency: (frequencyDays: number) => void
  onRemoveRecurring: () => void
  onSetOngoing: (checkInDays: number, targetEnd: string | null) => void
  reminderOffsets: readonly number[]
  onToggleReminder: (minutes: number) => void
  onClearReminders: () => void
}

/** The row ⋯ schedule menu's portal dimensions — same panel, same numbers as the grid card's. */
const ROW_MENU_W = 306
const ROW_MENU_MAX_H = 480

// One card-style task row, dressed as its grid-card TWIN: the same border scheme (solid
// status-colored top border, terracotta bucket sides — dashed when recurring), the same urgency
// glow ring + pulse + warm tint + 🔥 corner flag, the task text (with its status chip) on top, then
// the SHARED <CardActionBar> (outlined Done pill + ⋯/×) at the bottom — so a folded task reads
// identically to its card on the map. And BEHAVES identically: the ⋯ opens the same portaled
// SchedulePanel a grid card's ⋯ does (folded tasks used to have NO schedule path — you had to
// drag them out first). A plain tap on the row still opens inline renaming (handled upstream via
// the drag's onTap); a press-drag pulls the task out of the cluster; every bar control stops
// propagation so a click on it is never read as a drag.
function ClusterPopupRow({
  task,
  timeZone,
  editing,
  onStopEdit,
  onRename,
  onDone,
  onDelete,
  onPointerDown,
  onSetDue,
  onSetRecurring,
  onSetFrequency,
  onRemoveRecurring,
  onSetOngoing,
  reminderOffsets,
  onToggleReminder,
  onClearReminders,
}: ClusterPopupRowProps) {
  const rc = recurringStatus(task.recurring)
  // The grid card's border scheme, mirrored exactly (see GridCard): a solid status-colored TOP
  // border — recurring RC color, else quadrant color — with the terracotta bucket accent on the
  // other three sides (dashed + heavier for a recurring card, its "this repeats" outline).
  const borderColor = rc ? RC_COLOR[rc.code] : quadrantMeta(task.x ?? 0.5, task.y ?? 0.5).color
  const sideColor = rc ? borderColor : BUCKET_DOT
  // Rows stay date-granular (no live clock in the dense popup); the tier still colors the chip
  // consistently with the grid/list surfaces. A recurring row carries its own status color, so it
  // takes no urgency tier (mirrors the grid card gating glow on non-recurring tasks).
  const d = daysUntil(task.due, { timeZone })
  const tier = rc ? 'none' : urgencyTier(d, null)
  // The card's FULL urgency dress — glow ring + pulse + warm tint (+ the 🔥 corner flag below) —
  // so a folded overdue/near-due task reads identically to its standalone card on the map
  // (owner feedback 2026-07-09: not just the tint).
  const glow = urgencyGlowStyle(tier)
  const hotIcon = rc ? null : urgencyIcon(tier)
  // Cool-blue aging ring, per-row, same as the grid card — composed over the glow (or the base
  // card shadow when there's no glow, so the row's resting depth isn't lost).
  const aging = rc ? null : agingRingStyle(task)
  const boxShadow =
    glow || aging
      ? [glow ? glow.boxShadow : BASE_CARD_SHADOW, aging?.boxShadow].filter(Boolean).join(', ')
      : undefined

  // Dashed, slightly heavier accent sides for a recurring row — same treatment as GridCard.
  const recurringBorder: CSSProperties = rc
    ? {
        borderRightStyle: 'dashed',
        borderBottomStyle: 'dashed',
        borderLeftStyle: 'dashed',
        borderRightWidth: 2,
        borderBottomWidth: 2,
        borderLeftWidth: 2,
      }
    : {}

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

  // The ⋯ schedule menu — GridCard's exact pattern: PORTALED to <body> (this popup is itself a
  // fixed, height-capped scroller — an in-flow panel would clip), positioned via useAnchoredMenu
  // from the ⋯ wrapper's rect, measured in the open HANDLER, dismissed by a pointer-down outside
  // both the trigger wrapper and the portaled panel.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuPanelRef = useRef<HTMLDivElement>(null)
  const menuRefs = useMemo(() => [menuRef, menuPanelRef], [])
  useClickOutside(menuRefs, () => setMenuOpen(false), menuOpen)
  const { pos: menuPos, position: positionMenu } = useAnchoredMenu(menuRef, menuOpen, {
    width: ROW_MENU_W,
    maxHeight: ROW_MENU_MAX_H,
  })
  const toggleMenu = () => {
    if (!menuOpen) positionMenu()
    setMenuOpen((o) => !o)
  }

  return (
    <div
      data-testid="cluster-popup-row"
      data-task-id={task.id}
      // While editing the row is not a drag handle (the input owns its pointer events).
      onPointerDown={editing ? undefined : onPointerDown}
      // `relative` anchors the 🔥 corner flag; `my-2` gives the urgency rings breathing room
      // between stacked rows. Border colors/widths are all inline (grid-card scheme above).
      className={`relative mx-2 my-2 flex flex-col rounded-lg border bg-card px-2.5 py-2 text-ink shadow-sm ${
        editing ? '' : 'cursor-grab active:cursor-grabbing'
      }`}
      style={{
        borderTopWidth: 3,
        borderTopColor: borderColor,
        borderRightColor: sideColor,
        borderBottomColor: sideColor,
        borderLeftColor: sideColor,
        ...recurringBorder,
        touchAction: 'none',
        // Composed warm-glow + cool aging-ring shadow overrides the resting `shadow-sm`; the tint
        // is the warm urgency fill if any, else the cool aging fill — exactly the spread GridCard does.
        ...(boxShadow ? { boxShadow } : {}),
        ...(glow?.animation ? { animation: glow.animation } : {}),
        ...((glow?.background ?? aging?.background)
          ? { background: glow?.background ?? aging?.background }
          : {}),
      }}
    >
      {/* Hot-tier corner flag (🔥 = overdue or due-today) — the color-independent cue, same as the
          grid card's. Overhangs into the row's own margin, so it never clips the popup's scroller. */}
      {hotIcon && (
        <span
          aria-hidden
          title={hotIcon.label}
          className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-card text-[10px] leading-none shadow-sm"
          style={{ borderColor: dueChipStyle(tier).backgroundColor }}
        >
          {hotIcon.glyph}
        </span>
      )}
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
                className="flex-shrink-0 rounded px-1 text-[9px] font-semibold"
                style={dueChipStyle(tier)}
              >
                {d < 0 ? '!' : d === 0 ? 'now' : `${d}d`}
              </span>
            )
          )}
        </div>
      )}

      {/* The same action bar the grid card carries — and now the same ⋯ MEANING: it opens the
          shared SchedulePanel (renaming stays on a plain row tap). Delete is confirm-gated
          upstream. Hidden while renaming inline so it doesn't crowd the input. */}
      {!editing && (
        <CardActionBar
          recurring={task.recurring != null}
          onDone={onDone}
          onMenu={toggleMenu}
          onDelete={onDelete}
          menuLabel="Due date and recurring"
          menuTitle="Due date & recurring"
          menuOpen={menuOpen}
          menuRef={menuRef}
          menuContent={
            menuOpen &&
            createPortal(
              <div
                ref={menuPanelRef}
                role="menu"
                aria-label="Due date and recurring"
                // z-95: above this popup's own z-90 portal, still below the confirm dialog (z-100).
                className="fixed overflow-y-auto rounded-lg border border-border-strong bg-panel p-3 text-ink shadow-[0_8px_28px_rgba(0,0,0,.18)]"
                style={{
                  zIndex: 95,
                  width: ROW_MENU_W,
                  left: menuPos?.left ?? 8,
                  ...(menuPos?.bottom != null
                    ? { bottom: menuPos.bottom }
                    : { top: menuPos?.top ?? 8 }),
                  maxHeight: menuPos?.maxHeight ?? ROW_MENU_MAX_H,
                  visibility: menuPos ? 'visible' : 'hidden',
                }}
                // React events bubble through portals BY REACT TREE — without these stops a
                // pointer-down inside the panel would reach the row and start a tear-out drag.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <SchedulePanel
                  taskText={task.text}
                  due={task.due}
                  dueTime={task.due_time}
                  recurring={task.recurring}
                  timeZone={timeZone}
                  onSetDue={onSetDue}
                  onSetRecurring={onSetRecurring}
                  onSetFrequency={onSetFrequency}
                  onRemoveRecurring={onRemoveRecurring}
                  onSetOngoing={onSetOngoing}
                  reminderOffsets={reminderOffsets}
                  onToggleReminder={onToggleReminder}
                  onClearReminders={onClearReminders}
                  idPrefix="cluster"
                />
              </div>,
              document.body,
            )
          }
        />
      )}
    </div>
  )
}
