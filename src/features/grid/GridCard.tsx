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
import { IconButton } from '../../components/IconButton'
import { useClickOutside } from '../../hooks/use-click-outside'
import { RecurringSection } from '../recurring/RecurringSection'
import { BUCKET_DOT, CARD_WIDTH, RECURRING_BADGE_MIN_DONE } from './grid-constants'

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
  /**
   * Registers this card's root DOM node with the caller (GridView), which mutates its
   * `left`/`top` style directly during a drag instead of going through React state —
   * see the comment on `cardNodesRef` in GridView for why.
   */
  cardRef?: (node: HTMLDivElement | null) => void
  /** Pointer-down handler from useFreeDrag.startDrag(task.id) — begins a reposition drag. */
  onPointerDown: (event: PointerEvent) => void
  onRename: (text: string) => void
  onDelete: () => void
  /** Mark this task done — caller branches recurring (reset cycle) vs normal (write history). */
  onDone: () => void
  /** Commit a due date (ISO 'YYYY-MM-DD' or null) — writes `due` ONLY, never repositions. */
  onSetDue: (due: string | null) => void
  /** Set a fresh recurring schedule of N days (writes `recurring`, lastDoneAt null, count 0). */
  onSetRecurring: (frequencyDays: number) => void
  /** Change an already-recurring task's cadence (preserves lastDoneAt + doneCount). */
  onSetFrequency: (frequencyDays: number) => void
  /** Drop the recurring schedule (writes `recurring: null`). */
  onRemoveRecurring: () => void
}

// Stops a pointer-down from bubbling to the card root (which would start a reposition drag).
// Every on-card control uses this so a tap/click on it is never read as a drag.
const stopDrag = (e: PointerEvent) => e.stopPropagation()

/**
 * A single placed task card on the grid. The 3px top border encodes status: a recurring
 * task uses its RC_COLOR (overdue/due/soon/ok), otherwise the quadrant color for its (x,y).
 * The other three sides carry the bucket accent (BUCKET_DOT) — EisenClaw's per-bucket card
 * color, now uniform terracotta since only `oneoff` survives. Set as three long-hand colors
 * (not the `borderColor` shorthand) so a drag can imperatively override just `borderTopColor`.
 *
 * A RECURRING card is doubly marked so it reads as "repeats" at a glance, independent of the
 * status badge: (a) a persistent ↻ chip overhanging the top-right corner, and (b) DASHED
 * accent side/bottom borders (one-off cards keep thin solid terracotta sides) — see the style
 * object. The solid, status-colored top border is untouched so the two cues don't clash.
 *
 * Interactions: double-click the text to rename inline; hover reveals the action row (done /
 * ⋯ menu / delete). The ⋯ menu is a small popover with the due-date picker + the recurring
 * controls (RecurringSection) — setting a due date writes `due` only and never moves the card.
 * The whole card is the drag handle; every control stopPropagation so clicking it never starts
 * a drag (and double-click, being motionless, can't be confused with one either). Done marks a
 * normal task complete for today (it leaves the grid) or resets a recurring task's cycle.
 */
export function GridCard({
  task,
  screenX,
  screenY,
  daysUntilDue,
  dragging,
  cardRef,
  onPointerDown,
  onRename,
  onDelete,
  onDone,
  onSetDue,
  onSetRecurring,
  onSetFrequency,
  onRemoveRecurring,
}: GridCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.text)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Wraps the ⋯ trigger AND its popover, so a pointer-down on the trigger counts as "inside"
  // (its own onClick handles the toggle) while a click anywhere else closes the menu.
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen)

  // x/y are guaranteed non-null by the caller's filter, but be defensive for the type.
  const rc = recurringStatus(task.recurring)
  // Data-space quadrant for this card's (x, y). Drives the border color (when not recurring)
  // and a `data-quadrant` hook so E2E specs can assert placement without reading pixel styles
  // (durable across Stage 5's restyle).
  const quadrant = quadrantMeta(task.x ?? 0.5, task.y ?? 0.5)
  const borderColor = rc ? RC_COLOR[rc.code] : quadrant.color
  // Side/bottom accent = the task's bucket dot for one-offs (uniform terracotta — see BUCKET_DOT),
  // or the status accent for a recurring card (paired with the dashed style below).
  const sideColor = rc ? borderColor : BUCKET_DOT

  const showBadge = task.recurring != null && task.recurring.doneCount >= RECURRING_BADGE_MIN_DONE

  // Urgency glow + staleness dust apply only to non-recurring cards (a recurring task carries its
  // own RC_COLOR status; done tasks never reach the grid). See lib/visual-urgency.
  const glow = rc ? null : urgencyGlowStyle(daysUntilDue)
  const stale = rc ? null : stalenessStyle(task)

  // Recurring cards get DASHED, slightly heavier accent side/bottom borders — a distinct "this
  // repeats" outline that leaves the solid status-colored top border alone. Typed as CSSProperties
  // so the border-style string literals stay assignable when spread into `style`.
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

  const style: CSSProperties = {
    left: `${screenX * 100}%`,
    top: `${screenY * 100}%`,
    width: CARD_WIDTH,
    transform: dragging ? 'translate(-50%, -50%) scale(1.06)' : 'translate(-50%, -50%)',
    borderTopColor: borderColor,
    borderRightColor: sideColor,
    borderBottomColor: sideColor,
    borderLeftColor: sideColor,
    ...recurringBorder,
    touchAction: 'none',
    transition: dragging ? 'none' : 'box-shadow 120ms ease',
    // Glow overrides the resting shadow (its string carries its own drop-shadow layer). Overdue
    // cards also get the pulse animation; the keyframe is global (src/index.css). `animation` is
    // spread only when present so a future base animation on this card can't be clobbered.
    ...(glow
      ? { boxShadow: glow.boxShadow, ...(glow.animation ? { animation: glow.animation } : {}) }
      : {}),
    ...(stale ? { filter: stale.filter, opacity: stale.opacity } : {}),
    // Lift the card above its neighbors while its ⋯ menu is open so the popover isn't occluded.
    ...(menuOpen ? { zIndex: 40 } : {}),
    // Dragging treatment overrides glow/staleness opacity+shadow so the card under the pointer
    // always stays clearly visible, and lifts it above every other card while it moves.
    ...(dragging ? { opacity: 0.85, boxShadow: '0 10px 24px rgba(0,0,0,0.28)', zIndex: 30 } : {}),
  }

  function commitRename(): void {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== task.text) onRename(trimmed)
    setEditing(false)
  }

  function startEditing(): void {
    setDraft(task.text)
    setMenuOpen(false)
    setEditing(true)
  }

  // The ⋯ menu flips ABOVE the action row for cards low on the screen (and anchors to the right
  // edge for cards on the right half) so it stays on-canvas near the edges — mirrors ClusterPopup's
  // flip precedent, adapted to a menu anchored on the card's bottom-right rather than a centered
  // bubble.
  const menuStyle: CSSProperties = {
    zIndex: 50,
    width: 220,
    ...(screenY > 0.5 ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' }),
    ...(screenX > 0.5 ? { right: 0 } : { left: 0 }),
  }

  // The date picker wants 'YYYY-MM-DD'; `due` may be a full ISO timestamp, so slice the date.
  const dueValue = task.due ? task.due.slice(0, 10) : ''

  return (
    <div
      ref={cardRef}
      data-testid="grid-card"
      data-task-id={task.id}
      data-quadrant={quadrant.key}
      onPointerDown={editing ? undefined : onPointerDown}
      className="group absolute cursor-grab rounded-lg border bg-card text-xs text-ink shadow-sm hover:z-10 hover:shadow-md active:cursor-grabbing"
      style={{ ...style, borderTopWidth: 3, padding: '6px 8px 5px' }}
    >
      {/* Persistent recurring cue: a ↻ chip overhanging the top-right corner, decoupled from the
          status badge so a recurring card reads as "repeats" at a glance. Paper fill + accent
          border/glyph keeps it clean against the warm-paper card. Decorative (the badge below
          announces the status to screen readers); the title is a hover hint for sighted users. */}
      {rc && (
        <span
          aria-hidden
          title="Repeats"
          className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border bg-card text-[9px] font-bold leading-none shadow-sm"
          style={{ borderColor, color: borderColor }}
        >
          ↻
        </span>
      )}

      {/* Recurring status badge: a full-width colored block, status on line 1 (+ doneCount
          once >= 3) and cadence stacked as line 2 inside the same block — mirrors EisenClaw's
          two-line badge (html:569/587) rather than a single row of separate chips. */}
      {rc && (
        <div
          className="mb-0.5 block rounded-[3px] px-1 py-px text-[8.5px] font-bold leading-tight text-white"
          style={{ backgroundColor: RC_COLOR[rc.code] }}
        >
          <span>↻ {rc.label}</span>
          {showBadge && (
            <span className="ml-[3px] text-[7.5px] font-normal opacity-75">
              {task.recurring?.doneCount}×
            </span>
          )}
          {task.recurring && (
            <span className="block text-[7px] font-normal tracking-[0.03em] opacity-80">
              {fmtFrequency(task.recurring.frequencyDays)}
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
          onPointerDown={stopDrag}
          className="w-full rounded border border-border-strong bg-card px-1 py-0.5 text-xs"
        />
      ) : (
        // Double-click to edit inline. Motionless, so it can't be confused with a reposition drag
        // (the whole card is the drag handle) — the owner's chosen edit trigger (batch-2 item 5).
        <p
          className="break-words text-[10.5px] font-medium leading-[1.35]"
          title="Double-click to edit"
          onDoubleClick={startEditing}
        >
          {task.text}
        </p>
      )}

      {/* Non-recurring due badge — the textual half of the urgency layer (html:590). Terracotta
          when due within 2 days, muted grey otherwise. Recurring cards show their status badge
          above instead, so this is suppressed when `rc` is set. */}
      {!editing && !rc && daysUntilDue !== null && (
        <span
          className="mt-0.5 inline-block rounded-[3px] px-[5px] py-[1.5px] text-[9px] font-bold text-white"
          style={{ backgroundColor: daysUntilDue <= 2 ? DUE_BADGE_URGENT : DUE_BADGE_MUTED }}
        >
          {daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'today' : `${daysUntilDue}d`}
        </span>
      )}

      {/* Action row — inline at the bottom of the card, not a floating overlay, so its height
          is always reserved (mirrors EisenClaw's `.card-actions`, html:591/906-907, which hides
          via opacity rather than display for the same reason). Desktop: invisible + inert until
          hover, UNLESS the ⋯ menu is open (then it stays visible so the popover doesn't vanish
          when the pointer leaves). Mobile (< 720px, no hover): always visible. Each control stops
          propagation so a tap/click isn't a drag. Done = green, delete = red (shared B9
          IconButtons, tooltips); delete is confirm-gated by the caller. */}
      {!editing && (
        <div
          className={
            menuOpen
              ? 'pointer-events-auto mt-1 flex items-center gap-1 border-t border-border pt-1 text-muted opacity-100'
              : 'pointer-events-auto mt-1 flex items-center gap-1 border-t border-border pt-1 text-muted opacity-100 transition-opacity wide:pointer-events-none wide:opacity-0 wide:group-hover:pointer-events-auto wide:group-hover:opacity-100'
          }
        >
          <IconButton
            variant="success"
            className="!h-6 !w-6 !text-[13px]"
            onPointerDown={stopDrag}
            onClick={onDone}
            aria-label={task.recurring ? 'Mark done (resets clock)' : 'Mark done'}
            title={task.recurring ? 'Done (resets clock)' : 'Mark done'}
          >
            ✓
          </IconButton>

          <div className="relative ml-auto flex items-center gap-1">
            <div className="relative" ref={menuRef}>
              <IconButton
                variant="neutral"
                className="!h-6 !w-6 !text-[13px]"
                onPointerDown={stopDrag}
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Due date and recurring"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="Due date & recurring"
              >
                ⋯
              </IconButton>

              {menuOpen && (
                <div
                  role="menu"
                  aria-label="Due date and recurring"
                  className="absolute rounded-lg border border-border-strong bg-panel p-2.5 text-ink shadow-[0_8px_28px_rgba(0,0,0,.18)]"
                  style={menuStyle}
                  // Clicks inside the menu must not start a card drag or bubble to the grid.
                  onPointerDown={stopDrag}
                  onClick={(e) => e.stopPropagation()}
                >
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-muted">Due</span>
                    <input
                      type="date"
                      aria-label="Due date"
                      value={dueValue}
                      onChange={(e) => onSetDue(e.target.value === '' ? null : e.target.value)}
                      className="flex-1 rounded border border-border-strong bg-card px-2 py-1 text-xs"
                    />
                  </label>

                  <RecurringSection
                    task={task}
                    onSetRecurring={onSetRecurring}
                    onSetFrequency={onSetFrequency}
                    onRemoveRecurring={onRemoveRecurring}
                  />
                </div>
              )}
            </div>

            <IconButton
              variant="danger"
              className="!h-6 !w-6 !text-[13px]"
              onPointerDown={stopDrag}
              onClick={onDelete}
              aria-label="Delete task"
              title="Delete task"
            >
              ×
            </IconButton>
          </div>
        </div>
      )}
    </div>
  )
}
