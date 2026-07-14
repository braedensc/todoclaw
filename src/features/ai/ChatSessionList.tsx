import { useState } from 'react'
import { useChatSessions, useDeleteChatSession } from './use-chat-sessions'
import { useToast } from '../../components/use-toast'
import { PawPrint } from '../../components/PawPrint'

// The BabyClaw chat HISTORY list — an in-shell swap inside ChatConversation (so ChatRail + ChatPanel
// both get it). Browse saved conversations, open one to resume it, start a fresh one, or delete any
// (hard delete, cascades). Delete uses a lightweight two-click confirm (no modal → no ConfirmProvider
// dependency in the look-only demo) and an onError toast (the #241 rule — never a silent failure).

// Small bell for a proactive (BabyClaw-started) conversation in the history list.
function OriginBell() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  )
}

function relTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ChatSessionList({
  currentId,
  onOpen,
  onNew,
}: {
  currentId: string | null
  onOpen: (id: string) => void
  onNew: () => void
}) {
  const { data: sessions, isLoading } = useChatSessions()
  const del = useDeleteChatSession()
  const toast = useToast()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const confirmDelete = (id: string) =>
    del.mutate(id, {
      onSuccess: () => {
        setConfirmingId(null)
        if (id === currentId) onNew() // the open conversation was deleted — reset to a fresh chat
      },
      onError: () => toast("Couldn't delete that chat — try again.", 'error'),
    })

  return (
    <div className="flex min-h-0 flex-col">
      <button
        type="button"
        onClick={onNew}
        className="m-3 shrink-0 rounded border border-border-strong px-3 py-2 text-sm font-medium text-ink hover:bg-card"
      >
        <span aria-hidden className="mr-1">
          ＋
        </span>
        New chat
      </button>
      {/* Content-sized (grows to fit, scrolls past ~20rem) so this list works both in the top-right
          dropdown (ChatMenu) and the mobile chat drawer's history swap. */}
      <ul className="max-h-80 space-y-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {isLoading && <li className="px-2 text-sm text-muted">Loading…</li>}
        {!isLoading && (sessions?.length ?? 0) === 0 && (
          <li className="px-2 text-sm text-muted">No saved conversations yet.</li>
        )}
        {sessions?.map((s) => {
          const title = s.title?.trim() || 'Untitled chat'
          const active = s.id === currentId
          return (
            <li
              key={s.id}
              className={
                'flex items-center gap-1 rounded px-1 ' + (active ? 'bg-card' : 'hover:bg-card')
              }
            >
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm text-ink"
                title={title}
              >
                {/* Origin marker (unified history): a bell for a conversation BabyClaw started from
                    the inbox (plan/recap/reminder), a paw for one you started. */}
                <span
                  aria-hidden
                  className={
                    'grid h-5 w-5 shrink-0 place-items-center rounded-md ' +
                    (s.origin === 'proactive'
                      ? 'bg-puppy/10 text-puppy'
                      : 'bg-primary/10 text-primary')
                  }
                >
                  {s.origin === 'proactive' ? <OriginBell /> : <PawPrint className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {active && (
                    <span aria-hidden className="mr-1 text-accent">
                      ●
                    </span>
                  )}
                  {title}
                  <span className="ml-2 text-xs text-muted-light">{relTime(s.updated_at)}</span>
                </span>
              </button>
              {confirmingId === s.id ? (
                <span className="flex shrink-0 items-center gap-1 pr-1">
                  <button
                    type="button"
                    onClick={() => confirmDelete(s.id)}
                    className="rounded bg-accent px-2 py-1 text-xs font-medium text-white"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    className="rounded border border-border-strong px-2 py-1 text-xs text-ink"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingId(s.id)}
                  aria-label={`Delete ${title}`}
                  className="shrink-0 px-2 py-1 text-muted hover:text-accent"
                >
                  ✕
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
