import { useUnreadCount } from './use-messages'

// The inbox bell + unread badge (ADR-0031). A quiet trigger that opens the in-app message inbox;
// the badge counts unread plan/recap messages. Styled to sit among the header's other utility links
// (className is passed by the caller for desktop vs. mobile placement).
export function NotificationBell({
  onClick,
  className = 'relative hover:text-ink',
  compact = false,
}: {
  onClick: () => void
  className?: string
  /** Icon + badge only (no "Inbox" label) — for the tight mobile top bar. */
  compact?: boolean
}) {
  const unread = useUnreadCount()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={unread > 0 ? `Inbox, ${unread} unread` : 'Inbox'}
      title="Your daily plan & recap messages"
      className={className}
    >
      <span aria-hidden>🔔</span>
      {!compact && ' Inbox'}
      {unread > 0 && (
        <span
          aria-hidden
          className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )
}
