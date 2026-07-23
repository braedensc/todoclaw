import type { Task } from '../../types/task'
import { quadrantMeta } from '../../lib/quadrants'
import { RC_COLOR, recurringStatus } from '../../lib/recurring'
import { ONGOING_GLYPH } from '../../lib/task-type'
import {
  BASE_CARD_SHADOW,
  dueChipStyle,
  gridChipLabel,
  PAUSED_OPACITY,
  pausedChipLabel,
  pausedChipStyle,
  pausedRingStyle,
  staleBadge,
  staleChipStyle,
  staleness,
  staleRingStyle,
  urgencyGlowStyle,
  urgencyTier,
} from '../../lib/visual-urgency'
import { BUCKET_DOT, TOUCH_CHIP_WIDTH } from './grid-constants'

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
  /** Open this task's action sheet. */
  onTap: () => void
}

/**
 * A placed task on the fullscreen TOUCH grid (TouchGridSurface) — the 76px simplification of the
 * 112px desktop GridCard: one-line title + one status chip; everything else (actions, schedule,
 * rename) lives in the tap-opened TouchTaskSheet. The visual grammar is the card's, unchanged:
 * 3px status top border (RC_COLOR when recurring, else quadrant color), terracotta accent sides
 * (dashed + ↻ overhang when recurring, ∞ overhang when ongoing), and the same four exclusive
 * lanes in the same gating order as GridCard — paused first, then stale, then the warm urgency
 * tier; recurring exempt from all three. All state styling comes from lib/visual-urgency /
 * lib/recurring so the tiers can never drift from the desktop card.
 */
export function TouchGridChip({
  task,
  screenX,
  screenY,
  daysUntilDue,
  minutesUntilDue,
  paused = false,
  dimmed = false,
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

  // urgencyGlowStyle bakes BASE_CARD_SHADOW in; the cool rings deliberately don't — compose.
  const boxShadow =
    glow?.boxShadow ?? (coolRing ? `${BASE_CARD_SHADOW}, ${coolRing.boxShadow}` : undefined)
  const background = glow?.background ?? coolRing?.background

  const topColor = rc ? RC_COLOR[rc.code] : quadrant.color
  const sideColor = rc ? RC_COLOR[rc.code] : BUCKET_DOT

  return (
    <button
      type="button"
      data-testid="touch-chip"
      data-task-id={task.id}
      data-quadrant={quadrant.key}
      data-paused={paused || undefined}
      onClick={onTap}
      title={task.text}
      className="absolute rounded-[7px] bg-card px-1.5 pb-1 pt-0.5 text-left shadow-sm"
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
        zIndex: 10,
      }}
    >
      {/* Type overhang, same slot as GridCard's: ↻ repeats / ∞ ongoing (mutually exclusive). */}
      {(rc || task.ongoing) && (
        <span
          aria-hidden
          title={rc ? 'Repeats' : 'Ongoing project'}
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border bg-panel text-[9px] leading-none"
          style={{
            borderColor: rc ? RC_COLOR[rc.code] : quadrant.color,
            color: rc ? RC_COLOR[rc.code] : quadrant.color,
          }}
        >
          {rc ? '↻' : ONGOING_GLYPH}
        </span>
      )}

      <span className="block truncate text-[10px] font-medium leading-snug text-ink">
        {task.text}
      </span>

      {/* One status chip, same precedence as the card's chip slot: paused ⏸ / stale ❄️ /
          recurring status / due chip (only when dated). */}
      {paused ? (
        <span
          className="mt-0.5 inline-block rounded px-1 text-[7.5px] font-semibold leading-relaxed"
          style={pausedChipStyle()}
        >
          {pausedChipLabel(task.start_date)}
        </span>
      ) : frost ? (
        <span
          title={frost.title}
          className="mt-0.5 inline-block rounded px-1 text-[7.5px] font-semibold leading-relaxed"
          style={staleChipStyle()}
        >
          {frost.chip}
        </span>
      ) : rc ? (
        <span
          className="mt-0.5 inline-block rounded px-1 text-[7.5px] font-semibold leading-relaxed text-white"
          style={{ backgroundColor: RC_COLOR[rc.code] }}
        >
          ↻ {rc.label}
        </span>
      ) : tier !== 'none' && daysUntilDue !== null ? (
        <span
          className="mt-0.5 inline-block rounded px-1 text-[7.5px] font-semibold leading-relaxed"
          style={dueChipStyle(tier)}
        >
          {gridChipLabel(tier, daysUntilDue, task.due_time, minutesUntilDue)}
        </span>
      ) : null}
    </button>
  )
}
