import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, RefObject } from 'react'
import type { Task } from '../../types/task'
import { SchedulePanel } from '../schedule/SchedulePanel'
import { quadrantMeta } from '../../lib/quadrants'
import { RC_COLOR, recurringStatus } from '../../lib/recurring'
import {
  dueChipStyle,
  gridChipLabel,
  pausedChipLabel,
  staleBadge,
  staleness,
  urgencyTier,
} from '../../lib/visual-urgency'

const WIDTH = 340
const MAX_HEIGHT = 480
const GAP = 8
const MARGIN = 8

interface PopoverPos {
  left: number
  top?: number
  bottom?: number
  maxHeight: number
}

export interface TouchCardPopoverProps {
  task: Task
  /** Dormant (paused) card — read-only except the schedule path (Resume) and delete. */
  paused: boolean
  /**
   * Ref to the card's live DOM node to anchor to (GridSurface points it at getCardNode(id)).
   * A REF, not a plain node, deliberately: `reposition` then closes over a stable dependency,
   * so the measure-in-effect matches ClusterPopup's lint-clean shape (a prop-node dependency
   * trips react-hooks/set-state-in-effect).
   */
  anchorRef: RefObject<HTMLElement | null>
  /**
   * Bumped whenever the grid reflows (chat push-drawer, window resize) — the anchor card moves
   * but fires no scroll/resize event of its own, so this is the re-anchor signal (ClusterPopup's
   * reflowKey pattern; a ResizeObserver, not a window resize, drives the grid's reflow).
   */
  reflowKey: number
  daysUntilDue: number | null
  minutesUntilDue: number | null
  timeZone: string
  reminderOffsets: readonly number[]
  onClose: () => void
  onDone: () => void
  /** Delete — confirm-gated by the caller (the repo convention: confirm lives with the mutation). */
  onDelete: () => void
  onRename: (text: string) => void
  onSetDue: (due: string | null, dueTime: string | null) => void
  onSetRecurring: (frequencyDays: number) => void
  onSetFrequency: (frequencyDays: number) => void
  onRemoveRecurring: () => void
  onSetOngoing: (on: boolean) => void
  onSetStartDate: (startDate: string | null) => void
  onToggleReminder: (minutes: number) => void
  onClearReminders: () => void
}

/**
 * The iPad hybrid's card actions (workshop PR 4): on a coarse-pointer device in the DESKTOP
 * layout, tapping an inline-grid card opens this anchored popover — the iPad-native presentation
 * of TouchTaskSheet's content (the phone gets the bottom sheet; the DoneSheet/DonePage split
 * precedent). 44pt controls: Done / Schedule (the shared SchedulePanel behind a disclosure) /
 * Delete, plus tap-the-title rename. Anchoring mirrors ClusterPopup: fixed portal measured from
 * the card's live rect, below-else-flip-above, capped height with internal scroll, z-90 band,
 * stop-propagation guards (React events bubble through portals by REACT tree — a leak would
 * reach the card and start a drag).
 */
export function TouchCardPopover({
  task,
  paused,
  anchorRef,
  reflowKey,
  daysUntilDue,
  minutesUntilDue,
  timeZone,
  reminderOffsets,
  onClose,
  onDone,
  onDelete,
  onRename,
  onSetDue,
  onSetRecurring,
  onSetFrequency,
  onRemoveRecurring,
  onSetOngoing,
  onSetStartDate,
  onToggleReminder,
  onClearReminders,
}: TouchCardPopoverProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [showSchedule, setShowSchedule] = useState(false)
  const [pos, setPos] = useState<PopoverPos | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const reposition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const centerX = rect.left + rect.width / 2
    const left = Math.max(MARGIN, Math.min(centerX - WIDTH / 2, vw - WIDTH - MARGIN))
    const spaceBelow = vh - rect.bottom - GAP - MARGIN
    const spaceAbove = rect.top - GAP - MARGIN
    const flipAbove = spaceBelow < Math.min(MAX_HEIGHT, spaceAbove) && spaceAbove > spaceBelow
    if (flipAbove) {
      setPos({
        left,
        bottom: vh - rect.top + GAP,
        maxHeight: Math.max(0, Math.min(MAX_HEIGHT, spaceAbove)),
      })
    } else {
      setPos({
        left,
        top: rect.bottom + GAP,
        maxHeight: Math.max(0, Math.min(MAX_HEIGHT, spaceBelow)),
      })
    }
  }, [anchorRef])

  // Position after mount and on anything that can move the anchor (window scroll in capture —
  // the grid-only overlay scrolls its own box — resize, and the height change of the schedule
  // disclosure). Same pattern as ClusterPopup.
  useEffect(() => {
    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
    // showSchedule/editing change the panel height, and reflowKey bumps when the grid resizes
    // under a fixed anchor — re-measure on any of them so a flip/anchor stays correct.
  }, [reposition, showSchedule, editing, reflowKey])

  // Dismiss on any press OUTSIDE the popover. CAPTURE phase (+ a contains() check) is
  // load-bearing: grid cards and action-bar controls stopPropagation on pointerdown, which — via
  // React 18's root-delegated events — would swallow a BUBBLE-phase document listener, so tapping
  // another card / the card's ⋯ / a cluster bubble would never dismiss this (iPad-hybrid review).
  // Capture runs top-down before any target handler, so nothing downstream can block it; the
  // contains() check is what keeps a press inside the panel from self-dismissing.
  useEffect(() => {
    const onDocPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onDocPointerDown, true)
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true)
  }, [onClose])

  const quadrant = quadrantMeta(task.x ?? 0.5, task.y ?? 0.5)
  const rc = recurringStatus(task.recurring)
  const stale = rc || paused ? null : staleness(task, daysUntilDue)
  const tier = rc || stale || paused ? 'none' : urgencyTier(daysUntilDue, minutesUntilDue)
  const frost = stale ? staleBadge(stale) : null

  const commitRename = () => {
    const text = draft.trim()
    if (text && text !== task.text) onRename(text)
    setEditing(false)
  }

  const style: CSSProperties = {
    position: 'fixed',
    left: pos?.left ?? MARGIN,
    ...(pos?.bottom != null ? { bottom: pos.bottom } : { top: pos?.top ?? MARGIN }),
    width: WIDTH,
    maxHeight: pos?.maxHeight ?? MAX_HEIGHT,
    // The ⋯-menu band: above the fullscreen overlay (50), below the confirm dialog (100).
    zIndex: 90,
    visibility: pos ? 'visible' : 'hidden',
  }

  return createPortal(
    <div
      ref={panelRef}
      data-testid="touch-card-popover"
      role="dialog"
      aria-label={`Task: ${task.text}`}
      className="overflow-y-auto overscroll-contain rounded-xl border border-border-strong bg-panel p-3 shadow-[0_10px_30px_rgba(0,0,0,.2)]"
      style={style}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setEditing(false)
            }
          }}
          aria-label="Task name"
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 font-medium text-ink"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(task.text)
            setEditing(true)
          }}
          title="Tap to rename"
          className="flex min-h-[44px] w-full items-center text-left"
        >
          <span className="font-medium text-ink">{task.text}</span>
          <span aria-hidden className="ml-1.5 text-xs text-muted-faint">
            ✎
          </span>
        </button>
      )}

      <div className="mb-3 mt-1 flex items-center gap-2 text-xs text-muted">
        <span className="font-semibold uppercase tracking-wide" style={{ color: quadrant.color }}>
          {quadrant.label}
        </span>
        {paused ? (
          <span>{pausedChipLabel(task.start_date)}</span>
        ) : frost ? (
          <span title={frost.title}>{frost.chip}</span>
        ) : rc ? (
          <span style={{ color: RC_COLOR[rc.code] }}>↻ {rc.label}</span>
        ) : tier !== 'none' && daysUntilDue !== null ? (
          <span className="rounded px-1 font-semibold" style={dueChipStyle(tier)}>
            {gridChipLabel(tier, daysUntilDue, task.due_time, minutesUntilDue)}
          </span>
        ) : null}
      </div>

      {/* Action row — 44pt targets. Paused cards are read-only on the board: no Done; Schedule
          stays (it is the Resume path) and Delete stays. (No Move here — hold-drag IS the
          reposition path on the inline grid.) */}
      <div className="flex gap-2">
        {!paused && (
          <button
            type="button"
            onClick={onDone}
            className="min-h-[44px] flex-1 rounded-xl border border-primary bg-card text-sm font-semibold text-primary"
          >
            ✓ Done{rc ? ' (resets clock)' : ''}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowSchedule((s) => !s)}
          aria-expanded={showSchedule}
          className="min-h-[44px] flex-1 rounded-xl border border-border-strong bg-card text-sm font-semibold text-ink"
        >
          ⋯ Schedule
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete task"
          className="min-h-[44px] w-[52px] rounded-xl border border-border-strong bg-card text-base font-semibold text-danger"
        >
          ×
        </button>
      </div>

      {showSchedule && (
        <div className="mt-3 border-t border-border pt-3">
          <SchedulePanel
            taskText={task.text}
            due={task.due}
            dueTime={task.due_time}
            recurring={task.recurring}
            ongoing={task.ongoing}
            startDate={task.start_date}
            timeZone={timeZone}
            touch
            idPrefix="touchpop"
            reminderOffsets={reminderOffsets}
            onSetDue={onSetDue}
            onSetRecurring={onSetRecurring}
            onSetFrequency={onSetFrequency}
            onRemoveRecurring={onRemoveRecurring}
            onSetOngoing={onSetOngoing}
            onSetStartDate={onSetStartDate}
            onToggleReminder={onToggleReminder}
            onClearReminders={onClearReminders}
          />
        </div>
      )}
    </div>,
    document.body,
  )
}
