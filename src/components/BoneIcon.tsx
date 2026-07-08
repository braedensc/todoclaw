// A little dog bone — the habits surface's identity mark (habits are BabyClaw's daily routine,
// so they get his treats). Same recipe as SleepingPuppy: overlapping soft shapes in a single
// `currentColor` silhouette, so callers theme + size it with text/height utilities. Purely
// decorative — always render with aria-hidden context in mind (the component sets it).
export function BoneIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 44 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      {/* Two lobes per end + a shaft; the overlapping fills merge into one bone silhouette. */}
      <circle cx="10" cy="8" r="6" />
      <circle cx="10" cy="16" r="6" />
      <circle cx="34" cy="8" r="6" />
      <circle cx="34" cy="16" r="6" />
      <rect x="8" y="8" width="28" height="8" rx="4" />
    </svg>
  )
}
