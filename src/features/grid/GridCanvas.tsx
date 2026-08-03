import type { CSSProperties, PointerEvent, ReactNode, RefObject } from 'react'
import { quadrantMeta } from '../../lib/quadrants'
import { BACKGROUND_DISMISS_ATTR } from '../../hooks/use-background-dismiss'
import { AXIS_COLOR, GRIDLINE_COLOR, QUADRANT_TINT } from './grid-constants'
import { PawTrail } from './PawTrail'

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
    // Sizing controls clustering feel. Clusters fire in NORMALIZED space (CX=0.09, CY=0.07 in
    // lib/clustering), so a threshold's on-screen footprint = threshold × canvas px. EisenClaw's
    // grid was a fixed 1046×640 (html:537), which put CY at ~45px — about a card height, so cards
    // clustered only on genuine vertical overlap. We reproduce that FEEL by locking the desktop
    // canvas to the same 1046/640 aspect: width fills the column (dominant), height follows, so
    // CY stays proportional to EisenClaw instead of ballooning on tall viewports (a flat height
    // clamp let CY reach ~77px > card height, clustering cards that weren't even touching). Mobile
    // keeps its own fixed height; `wide:h-auto` releases that so the aspect-ratio can drive height.
    <div
      ref={surfaceRef}
      data-testid="grid-canvas"
      // Empty canvas is background: pressing it closes the open desktop chat rail. Only a press on
      // the canvas ITSELF counts (every layer below is pointer-events-none), so a card, cluster
      // bubble, or menu sitting on top is untouched by this — see useBackgroundDismiss.
      {...{ [BACKGROUND_DISMISS_ATTR]: true }}
      onPointerDown={onBackgroundPointerDown}
      className="relative h-[500px] overflow-hidden rounded-[14px] border border-border-strong bg-card shadow-[0_1px_2px_rgba(46,42,36,0.05),0_16px_40px_-18px_rgba(46,42,36,0.28)] wide:h-auto wide:aspect-[1046/640]"
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

      {/* Decorative character layer (style mix), under the cards: TodoClaw's paw trail wandering
          up toward Do Now, and a tiny ring marking the grid's true center — the point every
          placement is judged against. Both are pointer-events-none, so drags pass through. */}
      <PawTrail />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-muted-faint bg-bg"
      />

      {/* Corner quadrant labels (each in its own color). The TOP pair sits lower (top-7) so it
          clears the embedded Grid/List toggle and the Expand control that straddle / hug the top
          edge (B8); the bottom pair is nudged up to match. */}
      <span
        className="pointer-events-none absolute left-3 top-7 text-xs font-semibold uppercase tracking-wide"
        style={{ color: SCHEDULE.color }}
      >
        {SCHEDULE.label}
      </span>
      <span
        className="pointer-events-none absolute right-3 top-7 text-xs font-semibold uppercase tracking-wide"
        style={{ color: DO_NOW.color }}
      >
        {DO_NOW.label}
      </span>
      <span
        className="pointer-events-none absolute bottom-4 left-3 text-xs font-semibold uppercase tracking-wide"
        style={{ color: SOMEDAY.color }}
      >
        {SOMEDAY.label}
      </span>
      <span
        className="pointer-events-none absolute bottom-4 right-3 text-xs font-semibold uppercase tracking-wide"
        style={{ color: ERRANDS.color }}
      >
        {ERRANDS.label}
      </span>

      {/* Axis arrows now live OUTSIDE the canvas edges — rendered by GridAxes in GridSurface so
          they never overlap cards or the corner quadrant labels (B8, item 4). */}

      {children}
    </div>
  )
}
