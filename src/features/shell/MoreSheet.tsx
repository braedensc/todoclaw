import type { ReactNode } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { BoneIcon } from '../../components/BoneIcon'

// MoreSheet — the overflow for the mobile bottom nav (Concept D). Holds the low-frequency /
// harder-to-reach utility actions pushed out of the tall header: Daily habits, Settings, Admin
// (owner), and Sign out (destructive, last). A tap runs the action; each closes the sheet first so
// the underlying panel/overlay/route opens cleanly. (The proactive-message inbox is retired — it
// lives inside the Chat drawer now, reachable from the Chat tab.)

function MoreItem({
  glyph,
  label,
  onClick,
  danger = false,
}: {
  /** Leading mark — a text glyph, or a small inline icon node (the Daily habits bone). */
  glyph: ReactNode
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
  onReminders,
  onSettings,
  onAdmin,
  onSignOut,
  onClose,
}: {
  open: boolean
  /** Navigates to the Daily habits page (#/reminders). */
  onReminders: () => void
  onSettings: () => void
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
        {onAdmin && <MoreItem glyph="❖" label="Admin" onClick={run(onAdmin)} />}
        <MoreItem
          glyph={<BoneIcon className="inline h-3 w-auto align-middle text-puppy/80" />}
          label="Daily habits"
          onClick={run(onReminders)}
        />
        <MoreItem glyph="⚙" label="Settings" onClick={run(onSettings)} />
        <MoreItem glyph="⏻" label="Sign out" onClick={run(onSignOut)} danger />
      </div>
    </BottomSheet>
  )
}
