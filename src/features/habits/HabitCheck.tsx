import type { ChangeEvent } from 'react'

// The habit check, everywhere: a soft puppy-blue ring that fills with BabyClaw's paw print when
// done — one visual for the inline home list, the detail card, and each step, so tapping into a
// habit never changes palette (the old native checkboxes rendered accent-green). The paw pops in
// via CSS transitions only (nothing animates on mount, and motion-reduce neutralizes it).

// The white paw print stamped inside a checked circle. Sized relative to its parent circle.
function PawGlyph({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <ellipse cx="10" cy="13.2" rx="4.7" ry="3.7" />
      <circle cx="4.6" cy="8.4" r="2.2" />
      <circle cx="10" cy="6.4" r="2.3" />
      <circle cx="15.4" cy="8.4" r="2.2" />
    </svg>
  )
}

// The circular check visual (no input) — RemindersInline renders it inside its toggle buttons
// (which carry the aria-pressed + label semantics). `className` sizes the circle (h/w).
export function PawMark({ checked, className = '' }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex items-center justify-center rounded-full border transition-colors duration-150 motion-reduce:transition-none ${
        checked ? 'border-puppy bg-puppy text-white' : 'border-puppy/50 bg-transparent text-puppy'
      } ${className}`}
    >
      <PawGlyph
        className={`h-[62%] w-[62%] transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none ${
          checked ? 'scale-100 opacity-100' : 'scale-[0.4] opacity-0'
        }`}
      />
    </span>
  )
}

// A REAL checkbox wearing the paw skin. The input itself stretches invisibly (opacity-0) over
// the mark, so the accessible role/label/checked state, label-wrapping tap targets, jsdom tests,
// and the golden spec's toBeChecked() all keep working against a native control — only the paint
// changed. `className` sizes the whole control (h/w on the wrapper).
export function HabitCheckbox({
  checked,
  onChange,
  ariaLabel,
  className = '',
}: {
  checked: boolean
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none opacity-0"
      />
      <PawMark
        checked={checked}
        className="h-full w-full peer-focus-visible:ring-2 peer-focus-visible:ring-puppy/40 peer-focus-visible:ring-offset-1"
      />
    </span>
  )
}
