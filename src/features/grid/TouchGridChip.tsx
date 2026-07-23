import type { Task } from '../../types/task'
import { quadrantMeta } from '../../lib/quadrants'
import { RC_COLOR, recurringStatus } from '../../lib/recurring'
import { ONGOING_GLYPH } from '../../lib/task-type'
import {
  BASE_CARD_SHADOW,
  dueChipStyle,
  gridChipLabel,
  PAUSED_OPACITY,
  pausedBadge,
  pausedChipLabel,
  pausedChipStyle,
  pausedRingStyle,
  staleBadge,
  staleChipStyle,
  staleness,
  staleRingStyle,
  urgencyGlowStyle,
  urgencyIcon,
  urgencyTier,
} from '../../lib/visual-urgency'
import { BUCKET_DOT, RECURRING_BADGE_MIN_DONE, TOUCH_CHIP_WIDTH } from './grid-constants'

export interface TouchGridChipProps {
  task: Task
  /** Screen-space coordinates 0..1 (already y-inverted by the caller). */
  screenX: number
  screenY: number
  /** Timezone-aware whole days until due (daysUntil) — computed by the caller, like GridCard. */
  daysUntilDue: number | null
  /** Minutes until the due INSTANT for timed tasks (minutesUntilDueTime) — caller-computed. */
  minutesUntilDue: number | null
  /** Dormant (paused) chip — read-only dress; the caller renders these behind active chips. */
  paused?: boolean
  /** Dimmed while this chip is the one being moved (tap-to-place mode). */
  dimmed?: boolean
  /**
   * Registers this chip's DOM node with the surface, which paints the drag ghost imperatively
   * per frame (the desktop cardNodesRef pattern). Only wired for draggable (active) chips.
   */
  chipRef?: (node: HTMLButtonElement | null) => void
  /**
   * Pointer-down from useHoldDrag.startHold — press-and-hold lifts the chip into a drag; a
   * quick release is delivered back as the tap. When wired, plain pointer clicks are ignored
   * (the hook owns tap detection) and only KEYBOARD activation (click detail 0) falls through
   * to onTap, so Enter/Space still opens the sheet. Absent on read-only (paused) chips.
   */
  onHoldStart?: (event: React.PointerEvent) => void
  /** Open this task's action sheet. */
  onTap: () => void
}

/**
 * A placed task on the fullscreen TOUCH grid (TouchGridSurface) — the 76px simplification of the
 * 112px desktop GridCard: one-line title + one status chip; everything else (actions, schedule,
 * rename) lives in the tap-opened TouchTaskSheet. The visual grammar is the card's, unchanged:
 * 3px status top border (RC_COLOR when recurring, else quadrant color), terracotta accent sides
 * (dashed + ↻ corner disc when recurring, inline ∞ when ongoing), the 🔥/❄️/💤 corner flags, the
 * ×N recurring count, and the same four exclusive lanes in the same gating order as GridCard —
 * paused first, then stale, then the warm urgency tier; recurring exempt from all three. All
 * state styling comes from lib/visual-urgency / lib/recurring so the tiers can never drift from
 * the desktop card.
 */
export function TouchGridChip({
  task,
  screenX,
  screenY,
  daysUntilDue,
  minutesUntilDue,
  paused = false,
  dimmed = false,
  chipRef,
  onHoldStart,
  onTap,
}: TouchGridChipProps) {
  const quadrant = quadrantMeta(task.x ?? 0.5, task.y ?? 0.5)
  const rc = recurringStatus(task.recurring)
  // Lane gating order mirrors GridCard: paused gates first; staleness is skipped for recurring
  // and paused; the warm tier applies only when no other lane claimed the chip.
  const stale = rc || paused ? null : staleness(task, daysUntilDue)
  const tier = rc || stale || paused ? 'none' : urgencyTier(daysUntilDue, minutesUntilDue)
  const glow = urgencyGlowStyle(tier)
  const coolRing = paused ? pausedRingStyle() : staleRingStyle(stale)
  const frost = stale ? staleBadge(stale) : null
  // The 🔥/❄️/💤 corner-flag family, exactly as GridCard wears it. Never collides with the ↻
  // disc in the same slot: recurring cards are exempt from all three lanes by the gating above.
  const hotIcon = urgencyIcon(tier)
  const sleepBadge = paused ? pausedBadge(task.start_date) : null
  const flag = hotIcon
    ? { glyph: hotIcon.glyph, title: hotIcon.label, border: dueChipStyle(tier).backgroundColor }
    : frost
      ? { glyph: frost.glyph, title: frost.title, border: staleChipStyle().backgroundColor }
      : sleepBadge
        ? {
            glyph: sleepBadge.glyph,
            title: sleepBadge.title,
            border: pausedChipStyle().backgroundColor,
          }
        : null

  // urgencyGlowStyle bakes BASE_CARD_SHADOW in; the cool rings deliberately don't — compose.
  const boxShadow =
    glow?.boxShadow ?? (coolRing ? `${BASE_CARD_SHADOW}, ${coolRing.boxShadow}` : undefined)
  const background = glow?.background ?? coolRing?.background

  const topColor = rc ? RC_COLOR[rc.code] : quadrant.color
  const sideColor = rc ? RC_COLOR[rc.code] : BUCKET_DOT

  return (
    <button
      type="button"
      ref={chipRef}
      data-testid="touch-chip"
      data-task-id={task.id}
      data-quadrant={quadrant.key}
      data-paused={paused || undefined}
      onPointerDown={onHoldStart}
      // With hold-drag wired, the hook owns pointer tap detection (its pointerup fires onTap);
      // only keyboard activation — click with detail 0 — falls through here, so Enter/Space
      // still opens the sheet. Without it (paused chips), every click is the tap.
      onClick={(e) => {
        if (!onHoldStart || e.detail === 0) onTap()
      }}
      title={task.text}
      // The before: pseudo-element extends the TAP target ~10px beyond each edge (a bare
      // title-only chip is ~24px tall — far under the 44pt touch guideline) while the visible
      // chip stays small. Neighboring chips' invisible halos may overlap; the topmost wins,
      // exactly like visual overlap.
      className="absolute rounded-[7px] bg-card px-1.5 pb-1 pt-0.5 text-left shadow-sm before:absolute before:-inset-x-1.5 before:-inset-y-2.5 before:content-['']"
      style={{
        left: `${screenX * 100}%`,
        top: `${screenY * 100}%`,
        transform: 'translate(-50%, -50%)',
        width: TOUCH_CHIP_WIDTH,
        borderTop: `3px solid ${topColor}`,
        borderRight: `1px ${rc ? 'dashed' : 'solid'} ${sideColor}`,
        borderBottom: `1px ${rc ? 'dashed' : 'solid'} ${sideColor}`,
        borderLeft: `1px ${rc ? 'dashed' : 'solid'} ${sideColor}`,
        boxShadow,
        background,
        opacity: dimmed ? 0.45 : paused ? PAUSED_OPACITY : undefined,
        animation: glow?.animation,
        zIndex: paused ? 5 : 10,
        // Draggable chips must own their touches or scrolling steals the pointermove stream
        // mid-drag (use-free-drag's documented requirement).
        touchAction: onHoldStart ? 'none' : undefined,
      }}
    >
      {/* Top-right overhang disc — GridCard's corner slot, one occupant at a time: ↻ for a
          recurring chip, else the 🔥/❄️/💤 state flag. (Ongoing gets an inline ∞ prefix instead
          of the disc, so an overdue ongoing chip can wear its 🔥.) */}
      {rc ? (
        <span
          aria-hidden
          title="Repeats"
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border bg-panel text-[9px] leading-none"
          style={{ borderColor: RC_COLOR[rc.code], color: RC_COLOR[rc.code] }}
        >
          ↻
        </span>
      ) : flag ? (
        <span
          aria-hidden
          title={flag.title}
          className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border bg-card text-[9px] leading-none shadow-sm"
          style={{ borderColor: flag.border }}
        >
          {flag.glyph}
        </span>
      ) : null}

      <span className="block truncate text-[10px] font-medium leading-snug text-ink">
        {task.ongoing && (
          <span
            aria-hidden
            title="Ongoing project"
            className="mr-0.5"
            style={{ color: quadrant.color }}
          >
            {ONGOING_GLYPH}
          </span>
        )}
        {task.text}
      </span>

      {/* One status chip, same precedence as the card's chip slot: paused ⏸ / stale ❄️ /
          recurring status / due chip (only when dated). */}
      {paused ? (
        <span
          className="mt-0.5 inline-block rounded px-1 text-[9px] font-semibold leading-relaxed"
          style={pausedChipStyle()}
        >
          {pausedChipLabel(task.start_date)}
        </span>
      ) : frost ? (
        <span
          title={frost.title}
          className="mt-0.5 inline-block rounded px-1 text-[9px] font-semibold leading-relaxed"
          style={staleChipStyle()}
        >
          {frost.glyph} {frost.chip}
        </span>
      ) : rc ? (
        <span
          className="mt-0.5 inline-block rounded px-1 text-[9px] font-semibold leading-relaxed text-white"
          style={{ backgroundColor: RC_COLOR[rc.code] }}
        >
          ↻ {rc.label}
          {(task.recurring?.doneCount ?? 0) >= RECURRING_BADGE_MIN_DONE &&
            ` · ${task.recurring?.doneCount}×`}
        </span>
      ) : tier !== 'none' && daysUntilDue !== null ? (
        <span
          className="mt-0.5 inline-block rounded px-1 text-[9px] font-semibold leading-relaxed"
          style={dueChipStyle(tier)}
        >
          {gridChipLabel(tier, daysUntilDue, task.due_time, minutesUntilDue)}
        </span>
      ) : null}
    </button>
  )
}
