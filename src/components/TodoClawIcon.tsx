// The original jumping-up portrait of the real dog behind the name (cream curly fur, floppy tan
// ears, pale blue eyes). Since the style-mix pass the WORDMARK carries the clearer peeking-pup
// redraw (components/TodoClawPeek); this original now fronts the BabyClaw chat header (it is a
// picture of his namesake) and remains the favicon / PWA icon source. BabyClaw's 🐾 stays the
// reply/status glyph in messages and the mode toggle. Unlike the app's themed icons (which use
// `currentColor` so they follow text-color utilities), this one carries its own fixed portrait
// colors — it's a picture of a specific dog, not a UI accent.
export function TodoClawIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden className={className}>
      {/* Floppy ears, tan/grey like his real ears — outlined + sized to still read as ears at
          16-24px (favicon / chat-header scale), not just a faint smudge beside the head. */}
      <path
        d="M15,21 C3,25 1,44 13,52 C22,55 29,41 24,26 Z"
        fill="#b3a488"
        stroke="#2e2a24"
        strokeWidth="1.5"
      />
      <path
        d="M49,21 C61,25 63,44 51,52 C42,55 35,41 40,26 Z"
        fill="#b3a488"
        stroke="#2e2a24"
        strokeWidth="1.5"
      />
      {/* Head — cream curly fur, ink outline for a clean drawn-icon look */}
      <circle cx="32" cy="34" r="20" fill="#f8f2e6" stroke="#2e2a24" strokeWidth="1.5" />
      {/* Eyes — his actual pale blue */}
      <circle cx="24.5" cy="32" r="3.6" fill="#5f8aa3" />
      <circle cx="39.5" cy="32" r="3.6" fill="#5f8aa3" />
      <circle cx="23.3" cy="30.7" r="1" fill="#fff" />
      <circle cx="38.3" cy="30.7" r="1" fill="#fff" />
      {/* Nose + closed smile */}
      <ellipse cx="32" cy="41.5" rx="3.2" ry="2.4" fill="#2e2a24" />
      <path
        d="M32,44 q0,2.5 -3,3 M32,44 q0,2.5 3,3"
        stroke="#2e2a24"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />
      {/* A pair of paws with sharp claws reaching up beside the face — the "claw" in TodoClaw,
          posed like he's jumping up at you rather than just sitting still. Each is one <g> (pad +
          3 pointed nails) rotated outward around its own pad center, so both sides reuse the same
          local shape instead of hand-plotting mirrored coordinates. */}
      <g transform="translate(9,46) rotate(-25)">
        <ellipse cx="0" cy="0" rx="7" ry="6" fill="#f8f2e6" stroke="#2e2a24" strokeWidth="1.5" />
        <path d="M-5,-5 L-4,-15 L-2,-5 Z" fill="#2e2a24" />
        <path d="M-1,-6 L0,-16 L1,-6 Z" fill="#2e2a24" />
        <path d="M2,-5 L4,-15 L5,-5 Z" fill="#2e2a24" />
      </g>
      <g transform="translate(55,46) rotate(25)">
        <ellipse cx="0" cy="0" rx="7" ry="6" fill="#f8f2e6" stroke="#2e2a24" strokeWidth="1.5" />
        <path d="M-5,-5 L-4,-15 L-2,-5 Z" fill="#2e2a24" />
        <path d="M-1,-6 L0,-16 L1,-6 Z" fill="#2e2a24" />
        <path d="M2,-5 L4,-15 L5,-5 Z" fill="#2e2a24" />
      </g>
    </svg>
  )
}
