import type { CSSProperties, ReactNode } from 'react'
import type { Task } from '../../types/task'
import type { ClusterTraits } from '../../lib/clustering'
import { ONGOING_GLYPH } from '../../lib/task-type'
import {
  PAUSED_OPACITY,
  pausedChipStyle,
  pausedRingStyle,
  type GlowStyle,
  type StaleRingStyle,
} from '../../lib/visual-urgency'
import { CLUSTER_BUBBLE_SIZE, CLUSTER_DEPTH_OFFSET } from './cluster-constants'

export interface ClusterBubbleProps {
  /** The clustered tasks (length > 1); used for the count and depth shadows. */
  group: Task[]
  /** Accent color (from `clusterAccentColor`) for the ring, count, and depth rings. */
  accentColor: string
  /**
   * Which task types the cluster holds (from `clusterTraits`). Drives the mini trait discs along
   * the bubble's top edge (↻ repeating / ∞ ongoing / 💤 paused — the card corner-disc family, so
   * a bubble hints at what's folded inside) and, when EVERY member is dormant (`allPaused`), the
   * bubble's own paused dress: slate ring + tint + dim while closed, exactly like a paused card.
   */
  traits?: ClusterTraits | null
  /** Screen-space coordinates 0..1 (already y-inverted by the caller). */
  screenX: number
  screenY: number
  /**
   * Urgency glow for the whole cluster, from the nearest due date among its non-recurring tasks
   * (null = none). Applied only in the CLOSED state (ring + pulse + warm tint, matching a standalone
   * card) — an open bubble drops it for its raised popup shadow.
   */
  glow?: GlowStyle | null
  /**
   * Cool-blue stale ring for the whole cluster, from its DEEPEST-stale non-recurring member
   * (`clusterStaleness` → `staleRingStyle`) — the coldest task's ring, mirroring how `glow`
   * takes the nearest due. Applied only in the CLOSED state and composed over the glow/resting
   * shadow (own hue lane).
   */
  staleRing?: StaleRingStyle | null
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
  traits,
  screenX,
  screenY,
  glow,
  staleRing,
  open,
  onToggle,
  bubbleRef,
  children,
}: ClusterBubbleProps) {
  // Behind the bubble: one faint ring per extra task, up to two (slice 1..3 → two rings).
  const depthRings = group.slice(1, 3)

  // All members dormant → the bubble itself wears the paused dress while closed (slate ring +
  // tint + PAUSED_OPACITY dim), mirroring a standalone paused card. Mixed clusters stay in the
  // active dress — the 💤 trait disc below is what says "one of these is paused". By construction
  // an all-paused group has no glow (clusterNearestDue skips dormant) and no stale ring (a
  // dormant task is never stale), so the slate ring composes onto the resting shadow alone.
  const pausedDress = !open && traits?.allPaused ? pausedRingStyle() : null

  // The mini trait discs — the card corner-disc family, worn along the bubble's top edge. Each is
  // decorative to assistive tech (aria-hidden — the popup lists the members properly) but carries a
  // counted hover title, so they live INSIDE the button: a hover shows the count, a click is still
  // a click on the bubble. The loudest recurring member's RC color paints the ↻, ∞ takes the brand
  // primary (matching the card's ongoing badge), 💤 the slate.
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
  const traitDiscs = [
    ...(traits && traits.ongoing > 0
      ? [
          {
            key: 'ongoing',
            glyph: ONGOING_GLYPH,
            title: plural(traits.ongoing, 'ongoing project'),
            className: 'border-primary text-primary',
          },
        ]
      : []),
    ...(traits && traits.recurring > 0
      ? [
          {
            key: 'recurring',
            glyph: '↻',
            title: plural(traits.recurring, 'repeating task'),
            color: traits.recurringColor ?? undefined,
          },
        ]
      : []),
    ...(traits && traits.paused > 0
      ? [
          {
            key: 'paused',
            glyph: '💤',
            title: plural(traits.paused, 'paused task'),
            color: pausedChipStyle().backgroundColor,
          },
        ]
      : []),
  ]

  const wrapperStyle: CSSProperties = {
    left: `${screenX * 100}%`,
    top: `${screenY * 100}%`,
    transform: 'translate(-50%, -50%)',
    // Closed bubbles normally float above cards (z 3) — but an all-paused bubble stays at z auto
    // so the dormant-first DOM partition (use-grid) actually paints it BEHIND active cards, like
    // the paused singletons it stands in for. Open always raises for the popup.
    zIndex: open ? 60 : traits?.allPaused ? 'auto' : 3,
    userSelect: 'none',
    touchAction: 'none',
    // An all-paused bubble dims WHOLE while closed — circle, depth rings, and trait discs alike,
    // exactly as a paused card dims its own corner chips with it (open restores full strength so
    // the expanded popup reads clearly; the popup itself is portaled out and never dims).
    ...(pausedDress ? { opacity: PAUSED_OPACITY } : {}),
  }

  const bubbleStyle: CSSProperties = {
    width: CLUSTER_BUBBLE_SIZE,
    height: CLUSTER_BUBBLE_SIZE,
    border: `2px solid ${accentColor}`,
    // Open → raised popup shadow. Closed → the cluster's urgency glow if any (else the resting
    // shadow), with the cool-blue stale ring composed on top (its own hue lane) when a member has
    // gone stale. An overdue cluster also pulses AND takes the warm card tint (only while closed),
    // so a cluster holding an urgent task reads with the SAME ring + pulse + tint a standalone card
    // gets — and a stale cluster gains the same cool ring its coldest folded card would show.
    boxShadow: open
      ? '0 6px 20px rgba(0,0,0,.18)'
      : [
          glow?.boxShadow ?? '0 2px 8px rgba(0,0,0,.10)',
          staleRing?.boxShadow,
          pausedDress?.boxShadow,
        ]
          .filter(Boolean)
          .join(', '),
    ...(!open && glow?.animation ? { animation: glow.animation } : {}),
    // Closed-only card tint: the warm urgency fill if any, else the icy stale fill (its coldest
    // member's) or the slate paused fill — the cool-side mirrors of the warm tint, matching a
    // standalone card.
    ...(!open && (glow?.background ?? staleRing?.background ?? pausedDress?.background)
      ? { background: glow?.background ?? staleRing?.background ?? pausedDress?.background }
      : {}),
  }

  return (
    <div
      ref={bubbleRef}
      data-testid="cluster-bubble"
      data-task-id={group[0]?.id}
      {...(traits?.allPaused ? { 'data-paused': '' } : {})}
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

        {/* Trait discs — overhanging the top-right arc like a card's corner disc. INSIDE the
            button so a hover surfaces each disc's counted title and a click on a disc is still a
            click on the bubble (a sibling row needed pointer-events-none, which killed the
            tooltips). z-10 keeps them over the circle's border. */}
        {traitDiscs.length > 0 && (
          <span aria-hidden className="absolute -right-1 -top-1 z-10 flex gap-0.5">
            {traitDiscs.map((d) => (
              <span
                key={d.key}
                title={d.title}
                className={`flex h-4 w-4 items-center justify-center rounded-full border bg-card text-[9px] leading-none shadow-sm ${
                  'className' in d ? d.className : ''
                }`}
                style={'color' in d ? { borderColor: d.color, color: d.color } : undefined}
              >
                {d.glyph}
              </span>
            ))}
          </span>
        )}
      </button>

      {children}
    </div>
  )
}
