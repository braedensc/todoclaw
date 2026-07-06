// BabyClaw's actual likeness — a simple flat icon based on his real-life namesake (cream curly
// fur, one floppy tan ear, pale blue eyes). Unlike the app's themed icons (which use `currentColor`
// so they follow text-color utilities), this one carries its own fixed portrait colors — it's a
// picture of a specific dog, not a UI accent, so it doesn't reduce to a single hue. Used wherever
// there's room to render it clearly (chat header, favicon); the plain 🐾 emoji stays for tiny
// inline spots (mode toggle tab, message-bubble marker) where this much detail wouldn't read.
export function BabyClawIcon({ className }: { className?: string }) {
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
    </svg>
  )
}
