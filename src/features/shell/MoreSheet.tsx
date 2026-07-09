import type { ReactNode } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { BoneIcon } from '../../components/BoneIcon'

// MoreSheet — the overflow for the mobile bottom nav (Concept D). Holds the low-frequency /
// harder-to-reach utility actions pushed out of the tall header: Inbox (moved off the top bar so
// the hard-to-read mobile top can stay decorative), Daily habits, Settings, Backups, and Sign out
// (destructive, last). A tap runs the action; each closes the sheet first so the underlying
// panel/overlay/route opens cleanly. (Grid-only view is desktop-only now — there's no grid on
// mobile.)

function MoreItem({
  glyph,
  label,
  onClick,
  danger = false,
  badge = 0,
}: {
  /** Leading mark — a text glyph, or a small inline icon node (the Daily habits bone). */
  glyph: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  /** Optional unread count shown as a trailing chip (Inbox). 0 hides it. */
  badge?: number
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
      {badge > 0 && (
        <span
          aria-hidden
          className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-puppy px-1.5 text-[11px] font-semibold leading-none text-white"
        >
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

export function MoreSheet({
  open,
  onInbox,
  unread = 0,
  onReminders,
  onSettings,
  onBackups,
  onAdmin,
  onSignOut,
  onClose,
}: {
  open: boolean
  /** Opens the in-app message inbox (bell moved off the mobile top bar). */
  onInbox: () => void
  /** Unread message count, shown as a chip on the Inbox row and reflected on the More tab. */
  unread?: number
  /** Navigates to the Daily habits page (#/reminders). */
  onReminders: () => void
  onSettings: () => void
  onBackups: () => void
  // Owner-only: present only when the signed-in user is the app owner — opens the Admin panel (which
  // now holds invite management too). Omitted for everyone else.
  onAdmin?: () => void
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
        <MoreItem glyph="✉" label="Inbox" onClick={run(onInbox)} badge={unread} />
        {onAdmin && <MoreItem glyph="❖" label="Admin" onClick={run(onAdmin)} />}
        <MoreItem
          glyph={<BoneIcon className="inline h-3 w-auto align-middle text-puppy/80" />}
          label="Daily habits"
          onClick={run(onReminders)}
        />
        <MoreItem glyph="⚙" label="Settings" onClick={run(onSettings)} />
        <MoreItem glyph="↻" label="Backups" onClick={run(onBackups)} />
        <MoreItem glyph="⏻" label="Sign out" onClick={run(onSignOut)} danger />
      </div>
    </BottomSheet>
  )
}
