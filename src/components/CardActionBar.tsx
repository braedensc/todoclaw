import type { PointerEvent, ReactNode, RefObject } from 'react'
import { IconButton } from './IconButton'

// Stops a pointer-down from bubbling to the card/row root (which would start a reposition or
// tear-out drag). Every control in the bar uses this so a tap/click on it is never read as a drag.
const stopDrag = (e: PointerEvent) => e.stopPropagation()

export interface CardActionBarProps {
  /**
   * Whether the task recurs — only changes the Done button's wording ("resets clock"). The actual
   * recurring-vs-normal branch lives in the caller's `onDone`, not here.
   */
  recurring: boolean
  /** Mark the task done. */
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
 * Presentational only: it holds no state and owns no popover. The grid card passes its due/recurring
 * popover in via `menuContent` (+ `menuRef`/`menuOpen`); the cluster popup wires ⋯ straight to
 * inline edit and passes none of those.
 */
export function CardActionBar({
  recurring,
  onDone,
  onMenu,
  onDelete,
  menuLabel,
  menuTitle,
  menuOpen,
  menuRef,
  menuContent,
}: CardActionBarProps) {
  return (
    // data-card-actions: on coarse pointers, index.css grows every button here an invisible
    // ~44pt tap halo (the iPad hybrid — the visible controls stay desktop-dense).
    <div data-card-actions className="mt-1 flex items-center gap-0.5 border-t border-border pt-1">
      <button
        type="button"
        onPointerDown={stopDrag}
        onClick={onDone}
        aria-label={recurring ? 'Mark done (resets clock)' : 'Mark done'}
        title={recurring ? 'Done (resets clock)' : 'Mark done'}
        className="inline-flex items-center gap-0.5 rounded-full border border-primary px-1.5 py-[3px] text-[10px] font-semibold leading-none text-primary transition-colors hover:bg-primary/10"
      >
        <span aria-hidden className="text-[11px] leading-none">
          ✓
        </span>
        Done
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
