// A little paw print — a brand-neutral dog motif in the same spirit as BoneIcon / SleepingPuppy:
// one `currentColor` silhouette (main pad + four toe beans) so callers theme + size it with
// text/height utilities. Purely decorative; the component sets aria-hidden.
export function PawPrint({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      {/* Main pad */}
      <ellipse cx="12" cy="16.5" rx="5.4" ry="4.4" />
      {/* Four toe beans */}
      <circle cx="5.6" cy="10.6" r="2.5" />
      <circle cx="9.7" cy="6.6" r="2.7" />
      <circle cx="14.3" cy="6.6" r="2.7" />
      <circle cx="18.4" cy="10.6" r="2.5" />
    </svg>
  )
}
