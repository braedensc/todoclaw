import type { ButtonHTMLAttributes, ReactNode } from 'react'

// IconButton — the shared icon-only action affordance the app-wide polish items standardize on
// (tooltips #10, green-done / red-delete #12). Every icon control routes through this so size,
// border, hover intent, and accessibility stay consistent instead of each surface (grid card,
// list row, cluster popup, habits, done) hand-rolling its own <button>. Three intents:
//
//   neutral  quiet muted glyph → ink on hover (the current app style; the default)
//   success  green (`primary`) — "done" / confirm actions: a green border that deepens on hover,
//            green glyph + faint green wash on hover
//   danger   red (`danger`)   — destructive / delete actions: a red border that deepens on hover,
//            red glyph + faint red wash on hover
//
// The resting border already carries the variant's hue, so success/danger buttons read as
// green/red at a glance ("matching borders"); hover only intensifies. `title` (native tooltip)
// and `aria-label` (screen-reader name) are REQUIRED — an icon glyph carries no text, so omitting
// either would ship an unlabeled control; TypeScript enforces both at the call site.
//
// Sizing defaults to a 32px (h-8 w-8) square. Pass `className` to extend or override layout for a
// specific surface (e.g. "h-5 w-5 text-xs" for a compact row); every other <button> prop
// (onClick, disabled, type, onPointerDown, …) is forwarded.
//
//   <IconButton variant="danger" title="Delete task" aria-label="Delete task" onClick={remove}>
//     ×
//   </IconButton>

export type IconButtonVariant = 'neutral' | 'success' | 'danger'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Native tooltip shown on hover. Required — icon-only controls must be labeled. */
  title: string
  /** Accessible name announced by screen readers. Required — the glyph carries no text. */
  'aria-label': string
  /** Visual intent. Defaults to `neutral`. */
  variant?: IconButtonVariant
  children: ReactNode
}

const BASE =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border text-base leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50'

const VARIANTS: Record<IconButtonVariant, string> = {
  neutral: 'border-border-strong text-muted hover:bg-bg hover:text-ink',
  success:
    'border-primary/50 text-muted hover:border-primary hover:bg-primary/10 hover:text-primary',
  danger: 'border-danger/50 text-muted hover:border-danger hover:bg-danger/10 hover:text-danger',
}

export function IconButton({
  variant = 'neutral',
  className = '',
  type,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={`${BASE} ${VARIANTS[variant]} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  )
}
