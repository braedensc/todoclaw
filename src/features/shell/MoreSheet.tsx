import { BottomSheet } from '../../components/BottomSheet'

// MoreSheet — the overflow for the mobile bottom nav (Concept D). Holds the low-frequency /
// harder-to-reach utility actions pushed out of the tall header: Settings, Backups, and Sign out
// (destructive, last). A tap runs the action; each closes the sheet first so the underlying
// panel/overlay opens cleanly. (Grid-only view is desktop-only now — there's no grid on mobile.)

function MoreItem({
  glyph,
  label,
  onClick,
  danger = false,
}: {
  glyph: string
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-bg ' +
        (danger ? 'text-danger' : 'text-ink')
      }
    >
      <span aria-hidden className="w-5 text-center text-lg leading-none">
        {glyph}
      </span>
      {label}
    </button>
  )
}

export function MoreSheet({
  open,
  onSettings,
  onBackups,
  onInvite,
  onSignOut,
  onClose,
}: {
  open: boolean
  onSettings: () => void
  onBackups: () => void
  // Owner-only (ADR-0029): present only when the signed-in user is the app owner, so the owner can
  // mint an invite link from their phone. Omitted for everyone else.
  onInvite?: () => void
  onSignOut: () => void
  onClose: () => void
}) {
  const run = (fn: () => void) => () => {
    onClose()
    fn()
  }
  return (
    <BottomSheet open={open} onClose={onClose} title="More">
      <div className="flex flex-col gap-0.5">
        {onInvite && <MoreItem glyph="✉" label="Invite someone" onClick={run(onInvite)} />}
        <MoreItem glyph="⚙" label="Settings" onClick={run(onSettings)} />
        <MoreItem glyph="↻" label="Backups" onClick={run(onBackups)} />
        <MoreItem glyph="⏻" label="Sign out" onClick={run(onSignOut)} danger />
      </div>
    </BottomSheet>
  )
}
