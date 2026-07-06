// A small, single-color illustration for empty states (Done tab, Daily reminders) — a curled-up
// sleeping puppy in BabyClaw's own pose (see planning reference photos). Purely decorative
// (aria-hidden); `currentColor` so callers theme it with a text color utility, matching how the
// rest of the app themes icons rather than hardcoding fills.
export function SleepingPuppy({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 140 90"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
    >
      {/* Curled body */}
      <path
        d="M20,70 C8,54 14,33 36,26 C58,18 84,21 98,35 C112,49 109,69 90,75 C69,81 43,81 20,70 Z"
        fill="currentColor"
        opacity="0.55"
      />
      {/* Head */}
      <circle cx="30" cy="39" r="15" fill="currentColor" opacity="0.55" />
      {/* Floppy ear */}
      <path d="M19,29 C10,31 7,45 16,51 C23,53 27,44 25,35 Z" fill="currentColor" opacity="0.75" />
      {/* Snout */}
      <ellipse cx="17" cy="46" rx="7" ry="5.5" fill="currentColor" opacity="0.75" />
      {/* Closed eye */}
      <path
        d="M35,35 q4,3 8,0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.9"
        fill="none"
      />
      {/* Tail curl */}
      <path
        d="M99,54 q11,-6 6,-17"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.55"
        fill="none"
      />
      {/* Sleepy Zzz */}
      <text x="45" y="17" fontFamily="serif" fontSize="12" fill="currentColor" opacity="0.75">
        z
      </text>
      <text x="55" y="9" fontFamily="serif" fontSize="9" fill="currentColor" opacity="0.6">
        z
      </text>
    </svg>
  )
}
