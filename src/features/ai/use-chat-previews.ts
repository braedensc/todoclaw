import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { CHAT_SESSIONS_KEY } from './use-chat-sessions'
import { ChatPreviewSchema, type ChatPreview } from '../../types/chat'

// Per-session last-message snippet + user-visible message count, for the "Your chats" preview line
// and reply badge. One RPC for the whole list: PostgREST can't express "latest row per session", and
// the honest alternative — fetching every transcript — pulls the entire chat history into the browser
// to render 50 one-liners.
//
// Keyed as a CHILD of CHAT_SESSIONS_KEY on purpose. TanStack invalidation is prefix-matching, so the
// places that already invalidate ['chat_sessions'] — a finished chat turn, a `chats` tool domain, a
// delete, opening an inbox message — refresh these previews too, with no extra wiring to keep in sync.
export const CHAT_PREVIEWS_KEY = [...CHAT_SESSIONS_KEY, 'previews'] as const

// Matches the sessions list's own .limit(50) — a preview for a session the list won't render is waste.
const PREVIEW_LIMIT = 50

async function fetchPreviews(): Promise<ChatPreview[]> {
  const { data, error } = await supabase.rpc('chat_list_previews', { p_limit: PREVIEW_LIMIT })
  if (error) throw error
  // Drop a malformed row rather than blank every preview in the list (mirrors the transcript loader).
  const out: ChatPreview[] = []
  for (const r of data ?? []) {
    const parsed = ChatPreviewSchema.safeParse(r)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

export function useChatPreviews() {
  return useQuery({ queryKey: CHAT_PREVIEWS_KEY, queryFn: fetchPreviews })
}
