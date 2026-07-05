import { AXIS_LABEL_COLOR } from './grid-constants'

// Long, thin axis arrows drawn just OUTSIDE the grid canvas edges (B8, item 4 — replaces the
// short in-canvas labels from #68). Urgency runs along the BOTTOM pointing RIGHT (low→high);
// Importance runs up the LEFT pointing UP (low→high — the fix; #68 pointed it the wrong way).
// Each is a label at the low end, a hairline rail, and an arrowhead at the high end.
//
// Rendered by GridSurface inside a `relative` frame whose padding (pl / pb) reserves the outside
// gutters, so the arrows never overlap cards or the corner quadrant labels. Purely decorative.

const C = AXIS_LABEL_COLOR

export function GridAxes() {
  return (
    <div className="pointer-events-none" aria-hidden>
      {/* Importance — left gutter, vertical, pointing UP. Label at the bottom (low), arrow at top. */}
      <div className="absolute inset-y-0" style={{ left: -20, width: 14 }}>
        {/* rail */}
        <div
          className="absolute"
          style={{ left: '50%', top: 7, bottom: 62, width: 1.5, background: C }}
        />
        {/* arrowhead up */}
        <div
          className="absolute"
          style={{
            left: '50%',
            top: 0,
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderBottom: `7px solid ${C}`,
          }}
        />
        {/* label, reading bottom-to-top — a flex box brackets the rail (top/bottom match it) and
            centers the rotated word about its own center, so it stays centered on the rail
            regardless of the word's width and never overhangs the bottom-left corner. */}
        <div
          className="absolute flex items-center justify-center"
          style={{ left: 0, right: 0, top: 7, bottom: 62 }}
        >
          <span
            className="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.12em]"
            style={{ transform: 'rotate(-90deg)', transformOrigin: 'center center', color: C }}
          >
            Importance
          </span>
        </div>
      </div>

      {/* Urgency — bottom gutter, horizontal, pointing RIGHT. Label at the left (low), arrow at right. */}
      <div className="absolute inset-x-0" style={{ bottom: -18, height: 12 }}>
        {/* label */}
        <span
          className="absolute text-[9px] font-bold uppercase tracking-[0.12em]"
          style={{ left: 0, top: '50%', transform: 'translateY(-50%)', color: C }}
        >
          Urgency
        </span>
        {/* rail */}
        <div
          className="absolute"
          style={{
            left: 62,
            right: 8,
            top: '50%',
            height: 1.5,
            transform: 'translateY(-50%)',
            background: C,
          }}
        />
        {/* arrowhead right */}
        <div
          className="absolute"
          style={{
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 0,
            height: 0,
            borderTop: '4px solid transparent',
            borderBottom: '4px solid transparent',
            borderLeft: `7px solid ${C}`,
          }}
        />
      </div>
    </div>
  )
}
