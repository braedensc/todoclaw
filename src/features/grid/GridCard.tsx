import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, PointerEvent } from 'react'
import type { Task } from '../../types/task'
import { quadrantMeta } from '../../lib/quadrants'
import { RC_COLOR, recurringStatus, fmtFrequency, ongoingLabel } from '../../lib/recurring'
import {
  dueChipStyle,
  gridChipLabel,
  stalenessStyle,
  urgencyGlowStyle,
  urgencyIcon,
  urgencyTier,
} from '../../lib/visual-urgency'
import { CardActionBar } from '../../components/CardActionBar'
import { useClickOutside } from '../../hooks/use-click-outside'
import { useAnchoredMenu } from '../../hooks/use-anchored-menu'
import { SchedulePanel } from '../schedule/SchedulePanel'
import { BUCKET_DOT, CARD_WIDTH, RECURRING_BADGE_MIN_DONE } from './grid-constants'

export interface GridCardProps {
  task: Task
  /** Screen-space coordinates 0..1 (already y-inverted by the caller). */
  screenX: number
  screenY: number
  /** IANA timezone — anchors the ⋯ menu's SchedulePanel calendar ("today" = the user's day). */
  timeZone: string
  /**
   * Whole calendar days until this task's due date (from `daysUntil`, timezone-aware), or null
   * when it has no due date. Drives the urgency glow + the due badge. Computed by the caller so
   * the timezone lives in one place (GridView) rather than being threaded into every card.
   */
  daysUntilDue: number | null
  /**
   * Minutes until the exact due INSTANT for tasks with a due time (negative = past), null for
   * date-only tasks — from `minutesUntilDueTime` with the caller's shared `useNow` clock.
   * Flips a timed task to overdue when its instant passes and drives the final-hours countdown.
   */
  minutesUntilDue: number | null
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
  /** Write due date + time ('YYYY-MM-DD' / 'HH:MM', null to clear). Always both columns —
   *  clearing the date clears the time with it (the DB CHECK forbids a time without a date). */
  onSetDue: (due: string | null, dueTime: string | null) => void
  /** Set a fresh recurring schedule of N days (writes `recurring`, lastDoneAt null, count 0). */
  onSetRecurring: (frequencyDays: number) => void
  /** Change an already-recurring task's cadence (preserves lastDoneAt + doneCount). */
  onSetFrequency: (frequencyDays: number) => void
  /** Drop the recurring schedule (writes `recurring: null`). */
  onRemoveRecurring: () => void
  /** This task's selected reminder offsets (minutes before due); empty = none. Shown in the ⋯
   *  menu once the task has a due time; computed by the caller from the shared reminders query. */
  reminderOffsets: readonly number[]
  /** Toggle one reminder lead time on/off (writes task_reminders). */
  onToggleReminder: (minutes: number) => void
  /** Clear every reminder on this task (the Off chip). */
  onClearReminders: () => void
  /** For a recurring task: its fixed-cadence reminder time ('HH:MM[:SS]'), or null = none. */
  recurringReminderTime?: string | null
  /** Set ('HH:MM') or clear (null) the recurring task's reminder time. */
  onSetRecurringReminderTime?: (hhmm: string | null) => void
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
 * Interactions: double-click the text to rename inline. A persistent bottom action bar (always
 * visible, no hover-reveal, on desktop AND mobile) carries the controls: an OUTLINED green "Done"
 * pill on the left (border + green text + ✓, deliberately not filled so it reads as "mark done",
 * not "already done") plus small ⋯ menu / × delete icons on the right. The ⋯ menu is the shared
 * SchedulePanel (two-week calendar + time chips + remind + repeats — the one schedule editor) —
 * setting a due date writes `due` only and never moves the card. The whole card is the drag
 * handle; every
 * control stopPropagation so clicking it never starts a drag (and double-click, being motionless,
 * can't be confused with one either). Done marks a normal task complete for today (it leaves the
 * grid) or resets a recurring task's cycle.
 */
export function GridCard({
  task,
  screenX,
  screenY,
  timeZone,
  daysUntilDue,
  minutesUntilDue,
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
  reminderOffsets,
  onToggleReminder,
  onClearReminders,
  recurringReminderTime,
  onSetRecurringReminderTime,
}: GridCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.text)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // The ⋯ trigger wrapper (inside the card) and the PORTALED schedule popover. The popover left
  // the card's subtree when the SchedulePanel outgrew the old 220px in-canvas menu (a ~460px
  // panel clips against the grid's overflow-hidden — the exact lesson ClusterPopup learned,
  // item 16), so click-outside now checks both.
  const menuRef = useRef<HTMLDivElement>(null)
  const menuPanelRef = useRef<HTMLDivElement>(null)
  const menuRefs = useMemo(() => [menuRef, menuPanelRef], [])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  useClickOutside(menuRefs, () => setMenuOpen(false), menuOpen)

  // x/y are guaranteed non-null by the caller's filter, but be defensive for the type.
  const rc = recurringStatus(task.recurring)
  // Ongoing project vs. repeating chore — both live in `recurring`, so the same status color/hide
  // apply, but the badge reads as a project (▶ + target/sessions) instead of a repeat (↻ + cadence).
  const ongoing = ongoingLabel(task.recurring, { timeZone })
  const repeatGlyph = ongoing ? '▶' : '↻'
  // Data-space quadrant for this card's (x, y). Drives the border color (when not recurring)
  // and a `data-quadrant` hook so E2E specs can assert placement without reading pixel styles
  // (durable across Stage 5's restyle).
  const quadrant = quadrantMeta(task.x ?? 0.5, task.y ?? 0.5)
  const borderColor = rc ? RC_COLOR[rc.code] : quadrant.color
  // Side/bottom accent = the task's bucket dot for one-offs (uniform terracotta — see BUCKET_DOT),
  // or the status accent for a recurring card (paired with the dashed style below).
  const sideColor = rc ? borderColor : BUCKET_DOT

  const showBadge = task.recurring != null && task.recurring.doneCount >= RECURRING_BADGE_MIN_DONE

  // Urgency tier → glow + chip, applied only to non-recurring cards (a recurring task carries
  // its own RC_COLOR status; done tasks never reach the grid). See lib/visual-urgency.
  const tier = rc ? 'none' : urgencyTier(daysUntilDue, minutesUntilDue)
  const glow = urgencyGlowStyle(tier)
  const hotIcon = urgencyIcon(tier)
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
    // The resting transform reads --tc-lift (set by the hover class on this element) so the
    // card can rise on hover even though the transform is inline — a plain hover:transform
    // class would lose to this style attribute. Dragging owns its own transform (no lift).
    transform: dragging
      ? 'translate(-50%, -50%) scale(1.06)'
      : 'translate(-50%, -50%) translateY(var(--tc-lift, 0px))',
    borderTopColor: borderColor,
    borderRightColor: sideColor,
    borderBottomColor: sideColor,
    borderLeftColor: sideColor,
    ...recurringBorder,
    touchAction: 'none',
    transition: dragging ? 'none' : 'box-shadow 120ms ease, transform 120ms ease',
    // Glow overrides the resting shadow (its string carries its own drop-shadow layer). Overdue
    // cards also pulse and get a warm tint; the final hours pulse softly. Keyframes are global
    // (src/index.css). `animation`/`background` spread only when present so a future base value
    // on this card can't be clobbered.
    ...(glow
      ? {
          boxShadow: glow.boxShadow,
          ...(glow.animation ? { animation: glow.animation } : {}),
          ...(glow.background ? { background: glow.background } : {}),
        }
      : {}),
    ...(stale ? { filter: stale.filter, opacity: stale.opacity } : {}),
    // Lift the card above its neighbors while its ⋯ menu is open — the menu itself is portaled
    // (never occluded), so this is just a "this card is active" focus cue.
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

  // The schedule menu is PORTALED to <body> and positioned from the ⋯ wrapper's live rect —
  // prefer below, flip above when there's more room, clamp on-screen, scroll internally when
  // cramped (useAnchoredMenu, shared with the cluster-popup rows). 306px fits the SchedulePanel's
  // 7-column calendar (the old 220px in-card popover clipped its own date input — workshop #1).
  const MENU_W = 306
  const MENU_MAX_H = 480
  const { pos: menuPos, position: positionMenu } = useAnchoredMenu(menuRef, menuOpen, {
    width: MENU_W,
    maxHeight: MENU_MAX_H,
  })

  // Opening measures the trigger rect IN THE HANDLER (never a bare setState-in-effect), so the
  // panel mounts already positioned — no flash, no stale spot on reopen.
  const toggleMenu = () => {
    if (!menuOpen) positionMenu()
    setMenuOpen((o) => !o)
  }

  return (
    <div
      ref={cardRef}
      data-testid="grid-card"
      data-task-id={task.id}
      data-quadrant={quadrant.key}
      onPointerDown={editing ? undefined : onPointerDown}
      // hover:[--tc-lift:-2px] = the 2px hover rise (style mix): the inline transform above
      // consumes the var, so cards feel like index cards lifting off a desk. Desktop-only by
      // construction (the grid never renders on mobile).
      className="absolute cursor-grab rounded-lg border bg-card text-xs text-ink shadow-sm hover:z-10 hover:shadow-md hover:[--tc-lift:-2px] active:cursor-grabbing"
      style={{ ...style, borderTopWidth: 3, padding: '6px 8px 5px' }}
    >
      {/* Persistent recurring cue: a ↻ chip overhanging the top-right corner, decoupled from the
          status badge so a recurring card reads as "repeats" at a glance. Paper fill + accent
          border/glyph keeps it clean against the warm-paper card. Decorative (the badge below
          announces the status to screen readers); the title is a hover hint for sighted users. */}
      {rc && (
        <span
          aria-hidden
          title={ongoing ? 'Ongoing project' : 'Repeats'}
          className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border bg-card text-[9px] font-bold leading-none shadow-sm"
          style={{ borderColor, color: borderColor }}
        >
          {repeatGlyph}
        </span>
      )}

      {/* Hot-tier corner flag (🔥 = overdue or due-today) — the color-independent half of the
          urgency ladder, so a hot card reads apart from the gold/olive tiers even where the
          hue-based glow/chip can't (colorblindness, glare). Paper disc + tier-colored border keeps
          it legible on the warm tint. Decorative: the due chip below carries the same meaning as
          text for screen readers. Only non-recurring cards reach a hot tier, so it never collides
          with the ↻. */}
      {!rc && hotIcon && (
        <span
          aria-hidden
          title={hotIcon.label}
          className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-card text-[10px] leading-none shadow-sm"
          style={{ borderColor: dueChipStyle(tier).backgroundColor }}
        >
          {hotIcon.glyph}
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
          {/* Ongoing project: "▶ ongoing"/target on line 1, session ×N reuses the badge; a chore
              keeps "↻ status" + cadence. Line 2 carries the target for a project, cadence for a
              chore — a project's check-in cadence would read like a repeat, so it's hidden. */}
          <span>
            {repeatGlyph} {ongoing ? (ongoing.target ?? 'ongoing') : rc.label}
          </span>
          {showBadge && (
            <span className="ml-[3px] text-[7.5px] font-normal opacity-75">
              {task.recurring?.doneCount}×
            </span>
          )}
          {task.recurring && !ongoing && (
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

      {/* Non-recurring due chip — the textual half of the urgency ladder: tier-colored, says
          WHEN ("⏰ 3:00 PM", "in 45m", "Overdue · 2h") not just how many days. Recurring cards
          show their status badge above instead, so this is suppressed when `rc` is set. */}
      {!editing && !rc && daysUntilDue !== null && (
        <span
          className="mt-0.5 inline-block rounded-[3px] px-[5px] py-[1.5px] text-[9px] font-bold"
          style={dueChipStyle(tier)}
        >
          {gridChipLabel(tier, daysUntilDue, task.due_time, minutesUntilDue)}
        </span>
      )}

      {/* Persistent bottom action bar (Option B) — the shared <CardActionBar> (also used by each
          cluster-popup row, so the two can't drift): an OUTLINED green "Done" pill + small ⋯/×.
          The card supplies its own due/recurring popover as the ⋯ menu content, anchored inside the
          bar's ⋯ wrapper via `menuRef` and gated on `menuOpen`. Hidden while renaming inline. */}
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
                // Fixed + portaled so the ~460px panel can never be clipped by the grid canvas.
                // z-90 sits above the fullscreen grid overlay (z-50) and below the confirm dialog
                // (z-100), matching ClusterPopup. Hidden until the first measure lands.
                className="fixed overflow-y-auto rounded-lg border border-border-strong bg-panel p-3 text-ink shadow-[0_8px_28px_rgba(0,0,0,.18)]"
                style={{
                  zIndex: 90,
                  width: MENU_W,
                  left: menuPos?.left ?? 8,
                  ...(menuPos?.bottom != null
                    ? { bottom: menuPos.bottom }
                    : { top: menuPos?.top ?? 8 }),
                  maxHeight: menuPos?.maxHeight ?? MENU_MAX_H,
                  visibility: menuPos ? 'visible' : 'hidden',
                }}
                // React events bubble through portals BY REACT TREE — without these stops a click
                // inside the panel would reach the card root and start a reposition drag.
                onPointerDown={stopDrag}
                onClick={(e) => e.stopPropagation()}
              >
                {/* The ONE schedule editor (workshop direction B) — calendar + time chips +
                    remind + repeats, shared with the list/add surfaces so they can't drift. */}
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
                  reminderOffsets={reminderOffsets}
                  onToggleReminder={onToggleReminder}
                  onClearReminders={onClearReminders}
                  recurringReminderTime={recurringReminderTime}
                  onSetRecurringReminderTime={onSetRecurringReminderTime}
                  idPrefix="grid"
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
