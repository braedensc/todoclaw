import type { CSSProperties, PointerEvent, ReactNode, RefObject } from 'react'
import { quadrantMeta } from '../../lib/quadrants'
import { AXIS_COLOR, AXIS_LABEL_COLOR, GRIDLINE_COLOR, QUADRANT_TINT } from './grid-constants'

// Corner quadrant labels. Each rendered in its quadrantMeta color. The grid is y-inverted on
// screen, so the high-importance quadrants (Schedule / Do Now) sit at the top.
const SCHEDULE = quadrantMeta(0.25, 0.75)
const DO_NOW = quadrantMeta(0.75, 0.75)
const SOMEDAY = quadrantMeta(0.25, 0.25)
const ERRANDS = quadrantMeta(0.75, 0.25)

// The four region tints painted as one layered gradient. Each linear-gradient is a flat fill
// clipped to its quadrant via a hard 50% color stop on both axes, layered with the quadrant
// it shares an edge with. Simpler: paint each quadrant as an absolutely-positioned tint div.
const TINT_LAYER: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' }

// Graph-paper lines (10×10) plus the two heavier center axes, composed in one background.
const PAPER_STYLE: CSSProperties = {
  backgroundImage: [
    // center axes (1.5px) — drawn first so they sit under the cards but over the tints
    `linear-gradient(to right, transparent calc(50% - 0.75px), ${AXIS_COLOR} calc(50% - 0.75px), ${AXIS_COLOR} calc(50% + 0.75px), transparent calc(50% + 0.75px))`,
    `linear-gradient(to bottom, transparent calc(50% - 0.75px), ${AXIS_COLOR} calc(50% - 0.75px), ${AXIS_COLOR} calc(50% + 0.75px), transparent calc(50% + 0.75px))`,
    // 10×10 graph-paper lines
    `linear-gradient(to right, ${GRIDLINE_COLOR} 1px, transparent 1px)`,
    `linear-gradient(to bottom, ${GRIDLINE_COLOR} 1px, transparent 1px)`,
  ].join(','),
  backgroundSize: '100% 100%, 100% 100%, 10% 10%, 10% 10%',
}

export interface GridCanvasProps {
  surfaceRef: RefObject<HTMLDivElement>
  /** Click on empty canvas (used to commit tap-to-place and to close cluster popups later). */
  onBackgroundPointerDown?: (event: PointerEvent<HTMLDivElement>) => void
  /** Placed cards / cluster bubbles. */
  children: ReactNode
}

/**
 * The free-canvas grid surface: quadrant tints, 10×10 graph-paper lines, center axes, and
 * corner quadrant labels. Positions for children are computed by the caller (data-space →
 * screen via `left: x*100%`, `top: (1-y)*100%`). This component owns only the backdrop.
 */
export function GridCanvas({ surfaceRef, onBackgroundPointerDown, children }: GridCanvasProps) {
  return (
    <div
      ref={surfaceRef}
      data-testid="grid-canvas"
      onPointerDown={onBackgroundPointerDown}
      className="relative h-[500px] overflow-hidden rounded-[14px] border border-border-strong bg-card wide:h-[clamp(640px,78vh,1000px)]"
      style={PAPER_STYLE}
    >
      {/* Quadrant background tints (under the graph-paper lines is fine; they're translucent). */}
      <div
        style={{
          ...TINT_LAYER,
          top: 0,
          left: 0,
          width: '50%',
          height: '50%',
          background: QUADRANT_TINT.schedule,
        }}
      />
      <div
        style={{
          ...TINT_LAYER,
          top: 0,
          left: '50%',
          width: '50%',
          height: '50%',
          background: QUADRANT_TINT['do-now'],
        }}
      />
      <div
        style={{
          ...TINT_LAYER,
          top: '50%',
          left: 0,
          width: '50%',
          height: '50%',
          background: QUADRANT_TINT.someday,
        }}
      />
      <div
        style={{
          ...TINT_LAYER,
          top: '50%',
          left: '50%',
          width: '50%',
          height: '50%',
          background: QUADRANT_TINT.errands,
        }}
      />

      {/* Corner quadrant labels (each in its own color). */}
      <span
        className="pointer-events-none absolute left-3 top-2 text-xs font-semibold uppercase tracking-wide"
        style={{ color: SCHEDULE.color }}
      >
        {SCHEDULE.label}
      </span>
      <span
        className="pointer-events-none absolute right-3 top-2 text-xs font-semibold uppercase tracking-wide"
        style={{ color: DO_NOW.color }}
      >
        {DO_NOW.label}
      </span>
      <span
        className="pointer-events-none absolute bottom-2 left-3 text-xs font-semibold uppercase tracking-wide"
        style={{ color: SOMEDAY.color }}
      >
        {SOMEDAY.label}
      </span>
      <span
        className="pointer-events-none absolute bottom-2 right-3 text-xs font-semibold uppercase tracking-wide"
        style={{ color: ERRANDS.color }}
      >
        {ERRANDS.label}
      </span>

      {/* Edge axis labels (html:535-536). Additive absolute spans, vertically/horizontally
          centered so they clear the corner quadrant labels. The y-axis label reads bottom-to-top
          (rotate -90°) so its arrow points up. */}
      <span
        className="pointer-events-none absolute top-1/2 z-[3] whitespace-nowrap text-[10.5px] font-bold uppercase tracking-[0.1em]"
        style={{
          left: 6,
          color: AXIS_LABEL_COLOR,
          transform: 'rotate(-90deg) translateX(50%)',
          transformOrigin: 'left center',
        }}
      >
        Importance →
      </span>
      <span
        className="pointer-events-none absolute bottom-1 left-1/2 z-[3] -translate-x-1/2 text-[10.5px] font-bold uppercase tracking-[0.1em]"
        style={{ color: AXIS_LABEL_COLOR }}
      >
        Urgency →
      </span>

      {children}
    </div>
  )
}
