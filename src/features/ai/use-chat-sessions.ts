import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { ChatSessionSchema, type ChatSession } from '../../types/chat'

// The BabyClaw chat HISTORY list data layer (persistent-chats ADR). Every op is a plain RLS-scoped
// table call under the caller's JWT — no RPC, no user_id ever sent. The client can only SELECT +
// hard-DELETE; transcript writes are server-side (service_role DEFINER). Delete cascades to the
// session's messages. KEY matches DOMAIN_QUERY_KEYS.chats in use-ai-chat.ts.
export const CHAT_SESSIONS_KEY = ['chat_sessions'] as const

async function fetchSessions(): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('id, title, updated_at, pending')
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return ChatSessionSchema.array().parse(data)
}

export function useChatSessions() {
  return useQuery({ queryKey: CHAT_SESSIONS_KEY, queryFn: fetchSessions })
}

// Delete a whole conversation (hard delete; messages cascade via FK). RLS scopes it to the caller's
// own row. The caller wires onError to a toast so a failed delete doesn't vanish silently (#241).
export function useDeleteChatSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('chat_sessions').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY }),
  })
}
