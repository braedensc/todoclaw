import { useId } from 'react'

// TodoClaw's redrawn mark — the same real dog as TodoClawIcon (cream curly fur, tan floppy
// ears, pale blue eyes) but posed unmistakably: peeking over an edge, paws hooked over it with
// tiny claw tips dangling (the "claw" in Todoclaw), nose draped over the rail. Two variants:
//  - ledge (default): self-contained — he grips a drawn rail. Used beside the wordmark.
//  - ledge={false}: no rail — he peeks over the top border of whatever the parent positions
//    him on (the grid canvas). His chin is clipped at the border line (y=42.2 of the 64-unit
//    viewBox) so the element's edge reads as the thing he's hiding behind; position him with
//    top ≈ -(42.2/64 × rendered height) so the clip line sits exactly on the border.
// His eyes blink every few seconds via the .tc-eye-blink class (src/index.css, reduced-motion
// safe); `blinkClassName` lets a second pup on screen blink on an offset clock so the two never
// sync up like robots. Fixed portrait colors, like TodoClawIcon (which now marks the BabyClaw
// chat header) — it's a picture of a specific dog, not a themed UI accent.
export function TodoClawPeek({
  className,
  ledge = true,
  blinkClassName = 'tc-eye-blink',
}: {
  className?: string
  ledge?: boolean
  blinkClassName?: string
}) {
  const clipId = useId()

  // Ears → head → fur tuft → brows → eyes. Chin (head bottom) is hidden by the ledge rect or
  // the clip, whichever variant; nose + paws draw after so they overhang the edge.
  const face = (
    <>
      <path
        d="M21,14 C11,15 6,28 12,38 C15,43 20,41 20.5,32 C21,25 21.5,18 23,15 Z"
        fill="#b3a488"
        stroke="#2e2a24"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M43,14 C53,15 58,28 52,38 C49,43 44,41 43.5,32 C43,25 42.5,18 41,15 Z"
        fill="#b3a488"
        stroke="#2e2a24"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="30" r="17" fill="#f8f2e6" stroke="#2e2a24" strokeWidth="1.5" />
      <path
        d="M27.5,13.5 q2.2,-3.2 4.4,-0.4 q1.8,-2.8 3.6,0.2"
        fill="none"
        stroke="#2e2a24"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M21.5,23.5 q3,-2 6,-1 M36.5,22.5 q3,-1 6,1"
        fill="none"
        stroke="#2e2a24"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.6"
      />
      <g className={blinkClassName}>
        <circle cx="25" cy="29" r="3.5" fill="#5f8aa3" />
        <circle cx="23.8" cy="27.7" r="1" fill="#fff" />
      </g>
      <g className={blinkClassName}>
        <circle cx="39" cy="29" r="3.5" fill="#5f8aa3" />
        <circle cx="37.8" cy="27.7" r="1" fill="#fff" />
      </g>
    </>
  )

  return (
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden className={className}>
      {ledge ? (
        face
      ) : (
        <>
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="0" width="64" height="42.2" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>{face}</g>
        </>
      )}
      {ledge && (
        <rect
          x="5"
          y="41.5"
          width="54"
          height="7"
          rx="3.5"
          fill="#b3a488"
          stroke="#2e2a24"
          strokeWidth="1.5"
        />
      )}
      {/* Nose draped over the edge (drawn after the rail/clip so it overhangs), with a glint. */}
      <ellipse cx="32" cy="41.5" rx="4.2" ry="3.2" fill="#2e2a24" />
      <circle cx="30.8" cy="40.4" r="0.9" fill="#f8f2e6" opacity="0.85" />
      {/* Paws hooked over the edge: rounded pads, two toe lines, three dangling claw tips. */}
      <g>
        <rect
          x="14.5"
          y="39.5"
          width="10"
          height="9.5"
          rx="4.5"
          fill="#f8f2e6"
          stroke="#2e2a24"
          strokeWidth="1.5"
        />
        <path
          d="M17.8,44.5 v3.4 M21.2,44.5 v3.4"
          stroke="#2e2a24"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M16.2,49.4 l0.8,2 M19.5,49.8 l0.3,2.2 M22.8,49.4 l-0.4,2.1"
          stroke="#2e2a24"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </g>
      <g>
        <rect
          x="39.5"
          y="39.5"
          width="10"
          height="9.5"
          rx="4.5"
          fill="#f8f2e6"
          stroke="#2e2a24"
          strokeWidth="1.5"
        />
        <path
          d="M42.8,44.5 v3.4 M46.2,44.5 v3.4"
          stroke="#2e2a24"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M41.2,49.4 l0.8,2 M44.5,49.8 l0.3,2.2 M47.8,49.4 l-0.4,2.1"
          stroke="#2e2a24"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  )
}
