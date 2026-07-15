import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useChatSessions, useDeleteChatSession } from './use-chat-sessions'
import { useChatPreviews } from './use-chat-previews'
import { previewText, assistantSnippet } from './chat-preview'
import {
  useMessages,
  useMarkMessageRead,
  useOpenMessageChat,
  type InboxMessage,
} from '../notifications/use-messages'
import { kindLabel, proactiveDayLabel } from '../notifications/message-format'
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
//
// Every row carries a snippet of its last message (chat_list_previews) so you can tell which chat
// said what without opening it, and BabyClaw's check-ins carry a message count once you've replied —
// the tell for which of his openers you actually picked up.

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

// How many messages one of BabyClaw's check-ins holds — shown only once you've actually said
// something back. A check-in you've merely received sits at exactly 1 (chat_list_previews excludes
// the server-seeded hidden framing turn), so >1 is precisely "I've used this one"; the number then
// says how far the conversation went. Absent on your own chats — those are used by definition.
function ReplyBadge({ count }: { count: number }) {
  if (count <= 1) return null
  return (
    <span
      aria-label={`${count} messages`}
      className="shrink-0 rounded-full bg-puppy/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-puppy"
    >
      {count}
    </span>
  )
}

// One row's text column: name and time on the first line, last-message snippet on the second. The
// snippet gets a line to itself (rather than sharing with the time) because it's the part that has
// something to say; `truncate` does the ellipsis, so it adapts to the drawer's width.
function RowText({
  title,
  time,
  preview,
  bold,
  dot,
}: {
  title: string
  time: string
  preview: string
  bold?: boolean
  dot?: boolean
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline gap-2">
        <span
          className={
            'min-w-0 flex-1 truncate text-sm ' + (bold ? 'font-semibold text-ink' : 'text-ink')
          }
        >
          {dot && <span className="mr-1 text-accent">●</span>}
          {title}
        </span>
        <span className="shrink-0 text-[10px] text-muted-light">{time}</span>
      </span>
      {/* No snippet (a turn with nothing user-visible, or a chat with no messages yet) → the row
          simply stays one line rather than reserving an empty one. */}
      {preview && (
        <span className="mt-0.5 block truncate text-[11px] text-muted-light">{preview}</span>
      )}
    </span>
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
  const { data: previews } = useChatPreviews()
  const del = useDeleteChatSession()
  const openMsg = useOpenMessageChat()
  const markRead = useMarkMessageRead()
  const toast = useToast()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  // Cap BabyClaw's daily check-ins to the few most recent so the morning/evening cadence can't
  // pile up forever. Your own chats are shown in full, above.
  const MAX_PROACTIVE = 3
  // Rank a check-in by its LAST MESSAGE, not its arrival. `messages` arrives newest-first by
  // created_at, which is when BabyClaw SENT it — so replying to Monday's plan today left it sitting
  // three days down, and the cap below could drop the very conversation you were mid-reply in. Once
  // a check-in is opened it has a session, whose updated_at is the last-message clock
  // (chat_append_message bumps it every turn); an unopened one has no session, so its arrival time
  // IS its last message. Sorting must happen BEFORE the cap or it keeps the wrong three.
  const inbox = useMemo(() => {
    const byId = new Map((sessions ?? []).map((s) => [s.id, s]))
    const lastActivity = (m: InboxMessage) =>
      (m.session_id ? byId.get(m.session_id)?.updated_at : null) ?? m.created_at
    return [...(messages ?? [])]
      .sort((a, b) => Date.parse(lastActivity(b)) - Date.parse(lastActivity(a)))
      .slice(0, MAX_PROACTIVE)
      .map((m) => ({ msg: m, time: lastActivity(m) }))
  }, [messages, sessions])
  // Proactive sessions are shown via their message row, so keep only person-started chats.
  const userSessions = (sessions ?? []).filter((s) => s.origin === 'user')
  const loading = sessionsLoading || messagesLoading
  const empty = !loading && inbox.length === 0 && userSessions.length === 0

  // session id → what to show under its name, and how many messages it holds. Previews load on their
  // own (they're a second read); until they arrive, rows render as a name + time, exactly as before.
  const previewBySession = useMemo(() => {
    const m = new Map<string, { text: string; count: number }>()
    for (const p of previews ?? [])
      m.set(p.session_id, { text: previewText(p), count: p.msg_count })
    return m
  }, [previews])

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

        {/* You started — your own conversations (shown first, in full). */}
        {userSessions.length > 0 && <GroupLabel>You started</GroupLabel>}
        {userSessions.map((s) => {
          const title = s.title?.trim() || 'Untitled chat'
          const active = s.id === currentId
          const preview = previewBySession.get(s.id)?.text ?? ''
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
                <RowText
                  title={title}
                  time={relTime(s.updated_at)}
                  preview={preview}
                  dot={active}
                />
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

        {/* From BabyClaw — his daily check-ins, capped to the most recent few (below your chats). */}
        {inbox.length > 0 && <GroupLabel>From BabyClaw</GroupLabel>}
        {inbox.map(({ msg: m, time: lastAt }) => {
          const active = !!m.session_id && m.session_id === currentId
          const unread = !m.read_at
          // Day-stamp his daily check-ins ("Monday morning plan") so it's obvious which day each is;
          // reminders keep their own task-specific title.
          const dayTitle = proactiveDayLabel(m.kind, m.local_date)
          const title = dayTitle ?? m.title
          // A day-stamped title already says which check-in this is; a reminder's title is the task,
          // so it keeps its kind label. The stamp is the row's last message (the same clock it's
          // ranked by) — showing the arrival time here would read "3d ago" on a chat you just replied to.
          const time = dayTitle ? relTime(lastAt) : `${kindLabel(m.kind)} · ${relTime(lastAt)}`
          // Once opened, preview where the conversation actually got to. Until then there is no
          // session to read, and the check-in's own body IS its last (only) message.
          const seen = m.session_id ? previewBySession.get(m.session_id) : undefined
          const preview = seen?.text || assistantSnippet(m.body)
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => openMessage(m)}
              title={title}
              className={
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ' +
                (active ? 'bg-card ring-1 ring-border' : 'hover:bg-card')
              }
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-puppy/10 text-puppy">
                <BellGlyph />
              </span>
              <RowText title={title} time={time} preview={preview} bold={unread} />
              <ReplyBadge count={seen?.count ?? 0} />
              {unread && (
                <span
                  aria-label="unread"
                  className="h-2 w-2 shrink-0 rounded-full bg-puppy shadow-[0_0_0_3px_rgba(95,138,163,0.15)]"
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
