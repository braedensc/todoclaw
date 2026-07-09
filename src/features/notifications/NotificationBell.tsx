import { useUnreadCount } from './use-messages'

// The inbox bell + unread badge (ADR-0031). A quiet trigger that opens the in-app message inbox;
// the badge counts unread plan/recap messages. Styled to sit among the header's other utility links
// (className is passed by the caller for desktop vs. mobile placement).
export function NotificationBell({
  onClick,
  className = 'relative hover:text-ink',
  compact = false,
  tour,
}: {
  onClick: () => void
  className?: string
  /** Icon + badge only (no "Inbox" label) — for the tight mobile top bar. */
  compact?: boolean
  /** FeatureTour anchor name (`data-tour`) — the "your day comes to you" step points here. */
  tour?: string
}) {
  const unread = useUnreadCount()
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour={tour}
      aria-label={unread > 0 ? `Inbox, ${unread} unread` : 'Inbox'}
      title="Your daily plan & recap messages"
      className={className}
    >
      {/* Monochrome stroke bell (was a 🔔 emoji) so it matches the nav's other line glyphs;
          1em-sized so the caller's font-size scales it (quiet in the desktop nav, larger in the
          compact mobile bar). The unread chip is BabyClaw's slate-blue, not alert-red — the
          plan/recap messages are his, and unread mail isn't an emergency (style mix). */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        width="1em"
        height="1em"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="inline-block align-[-0.15em]"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {!compact && ' Inbox'}
      {unread > 0 && (
        <span
          aria-hidden
          className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-puppy px-1 text-[10px] font-semibold leading-none text-white"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )
}
