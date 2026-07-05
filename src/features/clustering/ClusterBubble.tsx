import type { CSSProperties, ReactNode } from 'react'
import type { Task } from '../../types/task'
import type { GlowStyle } from '../../lib/visual-urgency'
import { CLUSTER_BUBBLE_SIZE, CLUSTER_DEPTH_OFFSET } from './cluster-constants'

export interface ClusterBubbleProps {
  /** The clustered tasks (length > 1); used for the count and depth shadows. */
  group: Task[]
  /** Accent color (from `clusterAccentColor`) for the ring, count, and depth rings. */
  accentColor: string
  /** Screen-space coordinates 0..1 (already y-inverted by the caller). */
  screenX: number
  screenY: number
  /**
   * Urgency glow for the whole cluster, from the nearest due date among its non-recurring tasks
   * (null = none). Applied only in the CLOSED state — an open bubble uses its raised popup shadow.
   */
  glow?: GlowStyle | null
  /** True while the popup for this bubble is open (raises z-index + deepens the shadow). */
  open: boolean
  /** Open / close the popup. */
  onToggle: () => void
  /**
   * Registers this bubble's positioned wrapper node with the caller (useGrid), keyed by the
   * cluster's dominant id, so the merge preview can flag the whole bubble (grow + shadow) when a
   * dragged card would merge into a task folded inside it — the folded task has no card node of
   * its own. Attached to the wrapper (not the inner circle) because the wrapper carries the
   * `translate(-50%, -50%)` the merge-target CSS extends with `scale(...)`.
   */
  bubbleRef?: (node: HTMLDivElement | null) => void
  /** The popup, rendered inside the bubble's positioned wrapper so it anchors to the bubble. */
  children?: ReactNode
}

/**
 * A 64px circle standing in for an overlapping cluster of tasks. Shows the count above a
 * "TASKS" hint, ringed and colored by the dominant task's accent. Up to two faint depth
 * rings (`group.slice(1, 3)`, each offset ~4px up-right) imply the stack underneath.
 * Ported from EisenClaw (planning/EISENCLAW-LOGIC-TO-PORT.md §6, html:574-590).
 *
 * Clicking toggles the popup; the wrapper stops click propagation so opening the popup does
 * not also register as a grid-background click (which closes any open popup).
 */
export function ClusterBubble({
  group,
  accentColor,
  screenX,
  screenY,
  glow,
  open,
  onToggle,
  bubbleRef,
  children,
}: ClusterBubbleProps) {
  // Behind the bubble: one faint ring per extra task, up to two (slice 1..3 → two rings).
  const depthRings = group.slice(1, 3)

  const wrapperStyle: CSSProperties = {
    left: `${screenX * 100}%`,
    top: `${screenY * 100}%`,
    transform: 'translate(-50%, -50%)',
    zIndex: open ? 60 : 3,
    userSelect: 'none',
    touchAction: 'none',
  }

  const bubbleStyle: CSSProperties = {
    width: CLUSTER_BUBBLE_SIZE,
    height: CLUSTER_BUBBLE_SIZE,
    border: `2px solid ${accentColor}`,
    // Open → raised popup shadow. Closed → the cluster's urgency glow if any, else the resting
    // shadow. An overdue cluster also pulses (only while closed).
    boxShadow: open
      ? '0 6px 20px rgba(0,0,0,.18)'
      : (glow?.boxShadow ?? '0 2px 8px rgba(0,0,0,.10)'),
    ...(!open && glow?.animation ? { animation: glow.animation } : {}),
  }

  return (
    <div
      ref={bubbleRef}
      data-testid="cluster-bubble"
      data-task-id={group[0]?.id}
      className="absolute"
      style={wrapperStyle}
      // Stop BOTH events at the wrapper: the grid canvas dismisses popups on pointerdown
      // (GridView handleGridPointerDown), so a leaked pointerdown closed the popup before the
      // button's click toggled it — clicking an open bubble closed-then-instantly-reopened
      // instead of toggling closed. Clicks were already stopped so opening didn't re-dismiss.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Stacked depth rings — purely decorative; they sit behind the live bubble. */}
      {depthRings.map((t, i) => (
        <div
          key={t.id}
          aria-hidden
          className="absolute inset-0 rounded-full border bg-card opacity-50"
          style={{
            borderColor: accentColor,
            transform: `translate(${(i + 1) * CLUSTER_DEPTH_OFFSET}px, ${
              -(i + 1) * CLUSTER_DEPTH_OFFSET
            }px)`,
          }}
        />
      ))}

      <button
        type="button"
        title={`${group.length} tasks stacked here — click to expand`}
        aria-label={`${group.length} tasks stacked here`}
        aria-expanded={open}
        onClick={onToggle}
        className="relative flex cursor-pointer flex-col items-center justify-center rounded-full bg-card"
        style={bubbleStyle}
      >
        <span className="text-[22px] font-bold leading-none" style={{ color: accentColor }}>
          {group.length}
        </span>
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted">
          tasks
        </span>
      </button>

      {children}
    </div>
  )
}
