import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// The in-app inbox (ADR-0031). `messages` is the durable source of truth for the proactive daily
// plan/recap — push is best-effort on top, so the inbox is where a missed or dismissed push is
// recovered. Read via TanStack Query on load/focus (Realtime stays deferred, ADR-0021). RLS scopes
// rows to the caller; mark_message_read stamps read_at server-side.

const MESSAGES_KEY = ['messages'] as const

export interface InboxMessage {
  id: string
  kind: 'plan' | 'recap'
  local_date: string
  title: string
  body: string
  read_at: string | null
  created_at: string
}

async function fetchMessages(): Promise<InboxMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, kind, local_date, title, body, read_at, created_at')
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

export function useMarkMessageRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('mark_message_read', { p_id: id })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MESSAGES_KEY }),
  })
}
