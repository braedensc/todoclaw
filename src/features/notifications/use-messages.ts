import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// The in-app inbox (ADR-0031). `messages` is the durable source of truth for the proactive daily
// plan/recap — push is best-effort on top, so the inbox is where a missed or dismissed push is
// recovered. Read via TanStack Query on load/focus (Realtime stays deferred, ADR-0021). RLS scopes
// rows to the caller; mark_message_read stamps read_at server-side.

const MESSAGES_KEY = ['messages'] as const

export interface InboxMessage {
  id: string
  kind: 'plan' | 'recap' | 'reminder'
  local_date: string
  title: string
  body: string
  read_at: string | null
  created_at: string
  // The chat session this message was materialised into (null until first opened). Opening a message
  // now opens a real, persistent BabyClaw conversation seeded with it — see useOpenMessageChat.
  session_id: string | null
}

async function fetchMessages(): Promise<InboxMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, kind, local_date, title, body, read_at, created_at, session_id')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as InboxMessage[]
}

export function useMessages() {
  // refetchOnWindowFocus (TanStack default) is exactly right here — reopening the tab pulls any
  // messages that arrived while it was closed, without Realtime.
  return useQuery({ queryKey: MESSAGES_KEY, queryFn: fetchMessages })
}

/** Unread count for the bell badge. */
export function useUnreadCount(): number {
  const { data } = useMessages()
  return (data ?? []).reduce((n, m) => n + (m.read_at ? 0 : 1), 0)
}

/**
 * Mark one message read. OPTIMISTIC on purpose: the unread dot is the thing the user just acted on,
 * so it has to clear on the tap, not a round trip later. It also closes a real flicker — opening a
 * check-in fires this RPC and `chat_open_for_message` CONCURRENTLY, and any refetch that lands
 * between the two reads the row back as unread and repaints the dot on a chat you're standing in.
 * The cache write is what the list renders from until the server confirms; a failure rolls it back,
 * and the `onSettled` invalidate reconciles either way.
 */
export function useMarkMessageRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('mark_message_read', { p_id: id })
      if (error) throw error
    },
    onMutate: async (id: string) => {
      // Cancel in-flight reads first — one that resolves after this write would overwrite it.
      await qc.cancelQueries({ queryKey: MESSAGES_KEY })
      const previous = qc.getQueryData<InboxMessage[]>(MESSAGES_KEY)
      const now = new Date().toISOString()
      qc.setQueryData<InboxMessage[]>(MESSAGES_KEY, (rows) =>
        (rows ?? []).map((m) => (m.id === id && !m.read_at ? { ...m, read_at: now } : m)),
      )
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(MESSAGES_KEY, ctx.previous)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: MESSAGES_KEY }),
  })
}

/**
 * Mark EVERY unread message read in one shot — the badge's bulk escape hatch. Unread check-ins stay
 * visible past the chat list's display cap (so the "Chat N" badge always lands on a row), which
 * means ignoring them piles them up; this clears the pile without opening each one. Same security
 * envelope as mark_message_read: the RLS update policy scopes the write to the caller's own rows and
 * the column grant permits only `read_at` — no RPC needed. `.is('read_at', null)` keeps it
 * idempotent and leaves existing read stamps untouched.
 */
export function useMarkAllMessagesRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .is('read_at', null)
      if (error) throw error
    },
    // Same optimistic posture as the single mark — the whole point of the action is that the dots
    // go away now.
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: MESSAGES_KEY })
      const previous = qc.getQueryData<InboxMessage[]>(MESSAGES_KEY)
      const now = new Date().toISOString()
      qc.setQueryData<InboxMessage[]>(MESSAGES_KEY, (rows) =>
        (rows ?? []).map((m) => (m.read_at ? m : { ...m, read_at: now })),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(MESSAGES_KEY, ctx.previous)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: MESSAGES_KEY }),
  })
}

/**
 * Materialise (or reopen) the persistent BabyClaw chat session for an inbox message and return its
 * id. The RPC (SECURITY DEFINER, fenced to auth.uid()) creates the session + seeds the message as
 * BabyClaw's opening turn on the first open, and returns the SAME session on every reopen. Opening a
 * message therefore lands in its OWN conversation — never appended onto whatever chat resumed. The
 * caller then `openSession`s the returned id.
 *
 * `session_id` is the ONLY field this changes, and the RPC hands it straight back — so the row is
 * PATCHED in place rather than invalidated. An invalidate here refetched `messages` while the
 * caller's concurrent mark-read RPC was still in flight, and the response (still `read_at: null`)
 * repainted the unread dot on the check-in the user had just opened. Nothing else needs a reread;
 * the query still refetches on window focus.
 */
export function useOpenMessageChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (messageId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('chat_open_for_message', {
        p_message_id: messageId,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: (sessionId, messageId) => {
      qc.setQueryData<InboxMessage[]>(MESSAGES_KEY, (rows) =>
        (rows ?? []).map((m) => (m.id === messageId ? { ...m, session_id: sessionId } : m)),
      )
      void qc.invalidateQueries({ queryKey: ['chat_sessions'] })
    },
  })
}
