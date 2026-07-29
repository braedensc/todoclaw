import type { PointerEvent, ReactNode, RefObject } from 'react'
import type { PrimaryDoneAction } from '../lib/task-type'
import { IconButton } from './IconButton'

// Stops a pointer-down from bubbling to the card/row root (which would start a reposition or
// tear-out drag). Every control in the bar uses this so a tap/click on it is never read as a drag.
const stopDrag = (e: PointerEvent) => e.stopPropagation()

/**
 * The ✓ control's wording for each of the three done actions — one home, so the bar, the list row
 * and the two touch surfaces can't word the same gesture differently.
 *
 * The ONGOING arm is the one that isn't "done" at all: its ✓ logs that you put time in today and
 * the project stays exactly where it is, so it says WORKED, not Done, and reads as a toggle once
 * today is logged (tapping again un-logs it). The label stays short because the densest caller is
 * a 112px grid card; `title` carries the full promise ("the project stays on your board").
 *
 * The VISIBLE label is deliberately the same word in both states — only the fill changes. "Worked
 * today" wrapped to a second line on a grid card, which grew the card the moment a session was
 * logged: the one thing this feature promises NOT to do (log a session and nothing on the board
 * moves). The state is already carried three other ways that cost no width — the filled pill,
 * `aria-pressed`, and the card's own "✓ today" counter line directly above the bar — so the label
 * itself does not need to restate it. aria-label and title still say it in full.
 */
export function doneControlCopy(
  action: PrimaryDoneAction,
  workedToday = false,
): { label: string; ariaLabel: string; title: string } {
  switch (action) {
    case 'recurring-cycle':
      return { label: 'Done', ariaLabel: 'Mark done (resets clock)', title: 'Done (resets clock)' }
    case 'work-session':
      return workedToday
        ? {
            label: 'Worked',
            ariaLabel: 'Worked on this today — click to undo',
            title: 'Worked today (click to undo)',
          }
        : {
            label: 'Worked',
            ariaLabel: 'Log that you worked on this today',
            title: 'Log a session — the project stays on your board',
          }
    default:
      return { label: 'Done', ariaLabel: 'Mark done', title: 'Mark done' }
  }
}

export interface CardActionBarProps {
  /**
   * What this task's ✓ does — `primaryDoneAction(task)`. It only picks the button's wording and
   * (for an ongoing project) its filled state; the actual write lives in the caller's `onDone`.
   */
  doneAction: PrimaryDoneAction
  /**
   * ONGOING projects only: a session is already logged for today, so the pill reads FILLED
   * ("already banked") and clicking it un-logs today rather than logging a second session.
   */
  workedToday?: boolean
  /** Run the task's primary ✓ action (archive / recurring cycle / work session). */
  onDone: () => void
  /** ⋯ trigger — toggles the due/recurring menu (grid card) or opens inline edit (cluster popup). */
  onMenu: () => void
  /** Delete the task (callers confirm-gate this). */
  onDelete: () => void
  /** Accessible name for the ⋯ trigger — grid: "Due date and recurring"; popup: "Edit task". */
  menuLabel: string
  /** Tooltip for the ⋯ trigger; defaults to `menuLabel`. */
  menuTitle?: string
  /**
   * When defined, ⋯ is a popover trigger: `aria-haspopup="menu"` is set and `aria-expanded`
   * reflects this value. Omit it (cluster popup) and ⋯ carries neither attribute — a plain trigger.
   */
  menuOpen?: boolean
  /** Wraps ⋯ + its popover so a click-outside hook treats a click on the trigger as "inside". */
  menuRef?: RefObject<HTMLDivElement>
  /** Popover rendered next to ⋯ inside its relative wrapper — the grid card's due/recurring menu. */
  menuContent?: ReactNode
}

/**
 * The persistent bottom action bar shared by the grid card (GridCard) and each cluster-popup row
 * (ClusterPopup), so the two styles can't drift. A thin strip under a top hairline, ALWAYS visible
 * (no hover-reveal): an OUTLINED green "Done" pill on the left (green border + green text + ✓,
 * deliberately NOT filled so it reads as "mark done", not "already done"; hover adds a faint green
 * wash) and small quiet ⋯ (menu / edit) + × (delete, red-on-hover) IconButtons on the right. Every
 * control stopPropagation on pointer-down so a tap/click on it never starts a drag.
 *
 * The pill's wording comes from `doneControlCopy(doneAction)`, so an ONGOING project's ✓ says
 * "Worked" (a logged session, not a completion) and FILLS once today is banked — the single state
 * where a filled pill is honest, because there the ✓ is a toggle you can tap again to undo.
 *
 * Presentational only: it holds no state and owns no popover. The grid card passes its due/recurring
 * popover in via `menuContent` (+ `menuRef`/`menuOpen`); the cluster popup wires ⋯ straight to
 * inline edit and passes none of those.
 */
export function CardActionBar({
  doneAction,
  workedToday = false,
  onDone,
  onMenu,
  onDelete,
  menuLabel,
  menuTitle,
  menuOpen,
  menuRef,
  menuContent,
}: CardActionBarProps) {
  const done = doneControlCopy(doneAction, workedToday)
  // A logged session is the ONE state this pill fills for: everywhere else it stays outlined so it
  // reads as "mark done", not "already done" (see the header). Filled = today is already banked.
  const donePill = workedToday
    ? 'border-primary bg-primary text-white hover:bg-primary/90'
    : 'border-primary text-primary hover:bg-primary/10'

  return (
    // data-card-actions: on coarse pointers, index.css grows every button here an invisible
    // ~44pt tap halo (the iPad hybrid — the visible controls stay desktop-dense).
    <div data-card-actions className="mt-1 flex items-center gap-0.5 border-t border-border pt-1">
      <button
        type="button"
        onPointerDown={stopDrag}
        onClick={onDone}
        aria-label={done.ariaLabel}
        title={done.title}
        aria-pressed={doneAction === 'work-session' ? workedToday : undefined}
        className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-[3px] text-[10px] font-semibold leading-none transition-colors ${donePill}`}
      >
        <span aria-hidden className="text-[11px] leading-none">
          ✓
        </span>
        {done.label}
      </button>

      <div className="relative ml-auto flex items-center gap-1">
        <div className="relative" ref={menuRef}>
          <IconButton
            variant="neutral"
            className="!h-[18px] !w-[18px] !text-[11px]"
            onPointerDown={stopDrag}
            onClick={onMenu}
            aria-label={menuLabel}
            // A popover trigger (grid) advertises the popup + its open state; the popup's plain
            // edit trigger passes no `menuOpen`, so both attributes drop off.
            aria-haspopup={menuOpen === undefined ? undefined : 'menu'}
            aria-expanded={menuOpen}
            title={menuTitle ?? menuLabel}
          >
            ⋯
          </IconButton>
          {menuContent}
        </div>

        <IconButton
          variant="danger"
          className="!h-[18px] !w-[18px] !text-[11px]"
          onPointerDown={stopDrag}
          onClick={onDelete}
          aria-label="Delete task"
          title="Delete task"
        >
          ×
        </IconButton>
      </div>
    </div>
  )
}
