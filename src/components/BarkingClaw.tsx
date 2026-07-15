// TodoClaw mid-woof — the same real dog as TodoClawIcon / TodoClawPeek (cream curly fur, tan floppy
// ears, pale blue eyes), here announcing something: ears up, jaw dropped, tongue showing, with two
// sound arcs firing off to the right. He heads the "From BabyClaw" group in the chat list, so the
// arcs deliberately point INTO the label he's barking.
//
// Fixed portrait colors, like the other two — it's a picture of a specific dog, not a themed UI
// accent, so it does NOT take currentColor. Decorative (aria-hidden): the adjacent label is the
// accessible name, and a second announcement of "BabyClaw" would just be noise to a screen reader.
//
// The head sits left of centre (the whole face is translated) to leave the right third of the box
// for the bark. That keeps the head's own coordinates identical to TodoClawPeek's proven face, so
// the two drawings stay recognisably the same dog rather than drifting apart.
//
// The viewBox is cropped to what's actually drawn (measured bbox 4.4,13.7 → 58,50, padded for the
// 1.5–2.2 strokes that getBBox ignores) rather than left at the family's nominal 0 0 64 64. Those
// other marks fill their box; this one only fills 57% of it vertically, so an un-cropped 64-square
// would render him at ~57% of his nominal size and turn to mush at header scale. It is therefore
// WIDER THAN TALL (~1.4:1) — size it by height (h-8 w-auto), never with a square h-N w-N.
export function BarkingClaw({ className }: { className?: string }) {
  return (
    <svg viewBox="3 12 57 40" xmlns="http://www.w3.org/2000/svg" aria-hidden className={className}>
      <g transform="translate(-5,2)">
        {/* Ears — same shapes as the peeking pup, so he reads as the same dog. */}
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
        {/* Head + the fur tuft he's never without */}
        <circle cx="32" cy="30" r="17" fill="#f8f2e6" stroke="#2e2a24" strokeWidth="1.5" />
        <path
          d="M27.5,13.5 q2.2,-3.2 4.4,-0.4 q1.8,-2.8 3.6,0.2"
          fill="none"
          stroke="#2e2a24"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        {/* Brows lifted outward — eager, not angry. A barking dog that looks cross isn't cute. */}
        <path
          d="M21.8,22.6 q3,-2.6 6,-1 M36.2,21.6 q3,-1.6 6,1"
          fill="none"
          stroke="#2e2a24"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.65"
        />
        <circle cx="25" cy="28.5" r="3.5" fill="#5f8aa3" />
        <circle cx="23.8" cy="27.2" r="1" fill="#fff" />
        <circle cx="39" cy="28.5" r="3.5" fill="#5f8aa3" />
        <circle cx="37.8" cy="27.2" r="1" fill="#fff" />
        {/* Nose, with the same glint as the peek pup. It sits clear of the mouth: both are ink, so
            letting them touch merges them into one unreadable blob at any size. */}
        <ellipse cx="32" cy="33.4" rx="3.7" ry="2.8" fill="#2e2a24" />
        <circle cx="30.8" cy="32.4" r="0.85" fill="#f8f2e6" opacity="0.85" />
        {/* Philtrum — bridges the deliberate gap so nose and mouth still read as one muzzle. */}
        <path d="M32,36.2 v2.4" stroke="#2e2a24" strokeWidth="1.1" strokeLinecap="round" />
        {/* The bark itself: jaw dropped open under the nose. It breaks past the chin line on
            purpose — a mouth that stays inside the head silhouette just reads as a dark spot. */}
        <path
          d="M26.4,40 Q32,38 37.6,40 Q37.3,48.2 32,48.2 Q26.7,48.2 26.4,40 Z"
          fill="#2e2a24"
          stroke="#2e2a24"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        {/* Tongue, tucked at the back of the open mouth */}
        <path d="M29,43.4 h6 v2.2 a3,2.5 0 0 1 -6,0 Z" fill="#e5899b" />
      </g>
      {/* Woof — two sound arcs travelling toward the label. The outer one only fades to 0.55: any
          lighter and it stops reading as a second arc, which is what makes the pair say "sound"
          rather than "stray bracket". */}
      <path
        d="M46,29.5 q4.5,4.5 0,9"
        fill="none"
        stroke="#2e2a24"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.8"
      />
      <path
        d="M52.5,26 q7.5,8 0,16"
        fill="none"
        stroke="#2e2a24"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  )
}
