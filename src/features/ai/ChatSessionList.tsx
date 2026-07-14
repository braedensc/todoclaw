import { useState } from 'react'
import type { ReactNode } from 'react'
import { useChatSessions, useDeleteChatSession } from './use-chat-sessions'
import {
  useMessages,
  useMarkMessageRead,
  useOpenMessageChat,
  type InboxMessage,
} from '../notifications/use-messages'
import { useToast } from '../../components/use-toast'
import { PawPrint } from '../../components/PawPrint'
import { SleepingPuppy } from '../../components/SleepingPuppy'

// The unified "Your chats" list — BabyClaw's inbox AND your conversations in one warm place (the
// inbox is retired as a separate surface; the chat drawer IS the inbox now). Two groups:
//   • "From BabyClaw" — proactive plan/recap/reminder messages (the durable `messages` inbox). Opening
//     one materialises/reopens its own chat session (chat_open_for_message) and marks it read.
//   • "You started" — your own conversations (chat_sessions, origin='user'; proactive sessions are
//     represented by their message row above, so they're filtered out here to avoid duplicates).
// Rendered only inside ChatConversation's in-drawer history view (both shells), never the look-only
// demo — so it may freely use the messages/sessions query hooks.

function kindLabel(kind: InboxMessage['kind']): string {
  return kind === 'plan' ? 'Morning plan' : kind === 'recap' ? 'Evening recap' : 'Reminder'
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

// Small bell for a proactive (BabyClaw-started) conversation.
function BellGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="14"
      height="14"
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

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-light first:mt-1">
      {children}
    </p>
  )
}

export function ChatSessionList({
  currentId,
  onOpen,
  onNew,
}: {
  currentId: string | null
  onOpen: (sessionId: string) => void
  onNew: () => void
}) {
  const { data: sessions, isLoading: sessionsLoading } = useChatSessions()
  const { data: messages, isLoading: messagesLoading } = useMessages()
  const del = useDeleteChatSession()
  const openMsg = useOpenMessageChat()
  const markRead = useMarkMessageRead()
  const toast = useToast()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const inbox = messages ?? []
  // Proactive sessions are shown via their message row (above), so keep only person-started chats.
  const userSessions = (sessions ?? []).filter((s) => s.origin === 'user')
  const loading = sessionsLoading || messagesLoading
  const empty = !loading && inbox.length === 0 && userSessions.length === 0

  // Open an inbox message in its own conversation: mark read, then materialise/reopen its session.
  const openMessage = (m: InboxMessage) => {
    if (!m.read_at) markRead.mutate(m.id)
    if (m.session_id) {
      onOpen(m.session_id)
    } else {
      openMsg.mutate(m.id, {
        onSuccess: (sid) => onOpen(sid),
        onError: () => toast("Couldn't open that message — try again.", 'error'),
      })
    }
  }

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
      {/* Start a new chat — a warm dashed "invitation" card with a paw, matching the composer chips. */}
      <button
        type="button"
        onClick={onNew}
        className="m-3 mb-1 flex shrink-0 items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-card px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:border-puppy/50 hover:bg-panel"
      >
        <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
          <PawPrint className="h-3 w-3" />
        </span>
        Start a new chat
      </button>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-3">
        {loading && <p className="px-2 py-3 text-sm text-muted">Fetching your chats…</p>}

        {empty && (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <SleepingPuppy className="h-20 w-32 text-puppy/70" />
            <p className="font-serif text-sm font-semibold text-ink">No chats yet</p>
            <p className="max-w-[26ch] text-xs leading-relaxed text-muted">
              Say hi to BabyClaw, or turn on daily notifications and he’ll check in each morning.
            </p>
          </div>
        )}

        {/* From BabyClaw — the proactive inbox. */}
        {inbox.length > 0 && <GroupLabel>From BabyClaw</GroupLabel>}
        {inbox.map((m) => {
          const active = !!m.session_id && m.session_id === currentId
          const unread = !m.read_at
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => openMessage(m)}
              title={m.title}
              className={
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ' +
                (active ? 'bg-card ring-1 ring-border' : 'hover:bg-card')
              }
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-puppy/10 text-puppy">
                <BellGlyph />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={
                    'block truncate text-sm ' + (unread ? 'font-semibold text-ink' : 'text-ink')
                  }
                >
                  {m.title}
                </span>
                <span className="block truncate text-[11px] text-muted-light">
                  {kindLabel(m.kind)} · {relTime(m.created_at)}
                </span>
              </span>
              {unread && (
                <span
                  aria-label="unread"
                  className="h-2 w-2 shrink-0 rounded-full bg-puppy shadow-[0_0_0_3px_rgba(95,138,163,0.15)]"
                />
              )}
            </button>
          )
        })}

        {/* You started — your own conversations. */}
        {userSessions.length > 0 && <GroupLabel>You started</GroupLabel>}
        {userSessions.map((s) => {
          const title = s.title?.trim() || 'Untitled chat'
          const active = s.id === currentId
          return (
            <div
              key={s.id}
              className={
                'flex items-center gap-1 rounded-lg pr-1 transition-colors ' +
                (active ? 'bg-card ring-1 ring-border' : 'hover:bg-card')
              }
            >
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                title={title}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <PawPrint className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">
                    {active && <span className="mr-1 text-accent">●</span>}
                    {title}
                  </span>
                  <span className="block text-[11px] text-muted-light">
                    {relTime(s.updated_at)}
                  </span>
                </span>
              </button>
              {confirmingId === s.id ? (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => confirmDelete(s.id)}
                    className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-white"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    className="rounded-md border border-border-strong px-2 py-1 text-xs text-ink"
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
            </div>
          )
        })}
      </div>
    </div>
  )
}
