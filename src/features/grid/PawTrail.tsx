import { useId } from 'react'

// A faint trail of paw prints wandering up the grid from Someday toward Do Now — where its
// owner is peeking over the canvas edge (TodoClawPeek, rendered by GridSurface just left of
// the DO NOW label). Pure decoration: one aria-hidden svg spanning the canvas, rendered under
// the cards (GridCanvas mounts it before children), pointer-events pass straight through.
//
// Coordinates are in the canvas's native 1046×640 space (the aspect the canvas is locked to),
// so the trail scales uniformly with the grid. Gait alternates side to side; the prints get a
// touch larger and darker toward the destination — freshest steps last.
const PRINTS: Array<{ x: number; y: number; r: number; s: number; o: number }> = [
  { x: 146, y: 563, r: 40, s: 0.21, o: 0.05 },
  { x: 199, y: 531, r: 52, s: 0.21, o: 0.053 },
  { x: 230, y: 486, r: 44, s: 0.22, o: 0.056 },
  { x: 282, y: 454, r: 56, s: 0.22, o: 0.059 },
  { x: 324, y: 410, r: 48, s: 0.22, o: 0.062 },
  { x: 377, y: 378, r: 58, s: 0.23, o: 0.065 },
  { x: 429, y: 339, r: 50, s: 0.23, o: 0.068 },
  { x: 492, y: 301, r: 56, s: 0.23, o: 0.071 },
  { x: 554, y: 269, r: 60, s: 0.24, o: 0.074 },
  { x: 628, y: 237, r: 54, s: 0.24, o: 0.077 },
  { x: 690, y: 198, r: 62, s: 0.24, o: 0.08 },
  { x: 753, y: 166, r: 56, s: 0.25, o: 0.083 },
  { x: 816, y: 128, r: 60, s: 0.25, o: 0.086 },
  { x: 868, y: 90, r: 52, s: 0.25, o: 0.09 },
]

// One print (100×100 local units, ink fill), toes pointing up. Shared: the trail rotates it
// per step below, and GridSurface stamps it where a card was just marked done.
export function PawPrintShape() {
  return (
    <g fill="#2e2a24">
      <ellipse cx="50" cy="66" rx="24" ry="19" />
      <ellipse cx="22" cy="38" rx="9" ry="12" transform="rotate(-18 22 38)" />
      <ellipse cx="42" cy="26" rx="9" ry="12" transform="rotate(-6 42 26)" />
      <ellipse cx="62" cy="27" rx="9" ry="12" transform="rotate(8 62 27)" />
      <ellipse cx="80" cy="41" rx="9" ry="12" transform="rotate(20 80 41)" />
    </g>
  )
}

export function PawTrail() {
  const pawId = useId()
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1046 640"
    >
      <defs>
        <g id={pawId}>
          <PawPrintShape />
        </g>
      </defs>
      {PRINTS.map((p, i) => (
        <use
          key={i}
          href={`#${pawId}`}
          opacity={p.o}
          transform={`translate(${p.x} ${p.y}) scale(${p.s}) rotate(${p.r} 50 50)`}
        />
      ))}
    </svg>
  )
}
