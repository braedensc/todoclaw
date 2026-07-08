import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Tooltip } from './Tooltip'

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
// green/red at a glance ("matching borders"); hover only intensifies. `title` (tooltip text) and
// `aria-label` (screen-reader name) are REQUIRED — an icon glyph carries no text, so omitting
// either would ship an unlabeled control; TypeScript enforces both at the call site.
//
// `title` is NOT passed to the DOM button (that would summon the OS-default native tooltip —
// unstyleable and ~1s slow). Instead it renders through the custom <Tooltip> (Tooltip.tsx): a
// warm-paper bubble that pops in ~180ms, on hover AND keyboard focus, portaled so it is never
// clipped inside the cluster popup or Done modal. `aria-label` still names the button for AT.
//
// Sizing defaults to a 44px touch square below the 720px breakpoint (these are primary actions on
// phone rows, and Delete sits beside Done — mobile audit §2.1) and desktop's denser 32px square at
// `wide:`. Pass `className` to override for a specific surface — conflicting Tailwind utilities
// don't reliably win by string order, so size overrides must be `!important` arbitrary values
// (e.g. CardActionBar's "!h-[18px] !w-[18px]"); every other <button> prop (onClick, disabled,
// type, onPointerDown, …) is forwarded.
//
//   <IconButton variant="danger" title="Delete task" aria-label="Delete task" onClick={remove}>
//     ×
//   </IconButton>

export type IconButtonVariant = 'neutral' | 'success' | 'danger'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Tooltip text shown on hover/focus (via the custom <Tooltip>, not the native browser one).
   *  Required — icon-only controls must be labeled. */
  title: string
  /** Accessible name announced by screen readers. Required — the glyph carries no text. */
  'aria-label': string
  /** Visual intent. Defaults to `neutral`. */
  variant?: IconButtonVariant
  children: ReactNode
}

const BASE =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded border text-lg leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 wide:h-8 wide:w-8 wide:text-base'

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
  title,
  children,
  ...rest
}: IconButtonProps) {
  // `title` drives the custom Tooltip and is deliberately NOT spread onto the <button>, so no
  // native OS tooltip is summoned. `aria-label` stays in `...rest` → the button keeps its name.
  return (
    <Tooltip label={title}>
      <button
        type={type ?? 'button'}
        className={`${BASE} ${VARIANTS[variant]} ${className}`.trim()}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  )
}
