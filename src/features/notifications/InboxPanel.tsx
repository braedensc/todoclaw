import { useMessages, type InboxMessage } from './use-messages'

// The in-app inbox (ADR-0031) — a modal list of the durable plan/recap messages, newest first. This
// is the source of truth behind the push; opening a message deep-links into the chat (seeded) so the
// user can discuss/adjust, and marks it read. Modeled on the Settings/Backups overlay pattern.

function relativeDay(m: InboxMessage): string {
  // local_date is the user's calendar day (YYYY-MM-DD); show it plainly. created_at gives the time.
  const time = new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${m.local_date} · ${time}`
}

export function InboxPanel({
  onClose,
  onOpenMessage,
}: {
  onClose: () => void
  onOpenMessage: (id: string) => void
}) {
  const { data, isLoading } = useMessages()
  const messages = data ?? []

  return (
    <div
      role="dialog"
      aria-label="Inbox"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-10"
      onClick={onClose}
    >
      <section
        className="w-full max-w-lg rounded-xl border border-border-strong bg-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-ink">
            <span aria-hidden className="mr-1.5">
              🔔
            </span>
            Inbox
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inbox"
            className="text-muted hover:text-ink"
          >
            ✕
          </button>
        </header>

        {isLoading ? (
          <p className="py-6 text-sm text-muted">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="py-6 text-sm text-muted">
            No messages yet. Turn on daily notifications in Settings to get a morning plan and an
            evening recap.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onOpenMessage(m.id)}
                  className="flex w-full flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2 text-left hover:border-border-strong"
                >
                  <span className="flex items-center gap-2">
                    {!m.read_at && (
                      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                    )}
                    <span
                      className={`text-sm ${m.read_at ? 'text-ink' : 'font-semibold text-ink'}`}
                    >
                      {m.title}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-xs text-muted">{m.body}</span>
                  <span className="text-[11px] text-muted-light">{relativeDay(m)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
