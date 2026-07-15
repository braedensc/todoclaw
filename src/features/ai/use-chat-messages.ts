import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { ChatMessageRowSchema, type ChatMessageRow } from '../../types/chat'
import { assistantText } from './assistant-text'
import type { ChatItem } from './use-ai-chat'

// Load one session's persisted transcript (oldest-first) for HYDRATION — the base history shown when
// a saved chat is opened/resumed. It is frozen for the visit (staleTime Infinity, no window-focus
// refetch): live streaming this visit is appended as `liveItems` in use-ai-chat, so refetching the
// base mid-visit would double-render turns already streamed. A full reload remounts → fresh fetch.
export const chatMessagesKey = (sessionId: string) => ['chat_messages', sessionId] as const

async function fetchMessages(sessionId: string): Promise<ChatMessageRow[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('seq, role, content, meta')
    .eq('session_id', sessionId)
    .order('seq', { ascending: true })
  if (error) throw error
  // Drop a malformed row rather than wedge the whole conversation (mirrors the server loader).
  const out: ChatMessageRow[] = []
  for (const r of data ?? []) {
    const parsed = ChatMessageRowSchema.safeParse(r)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

// Only fetches when a session id is present (a brand-new, unsent chat has no persisted base).
export function useChatMessages(sessionId: string | null) {
  return useQuery({
    queryKey: chatMessagesKey(sessionId ?? '∅'),
    queryFn: () => fetchMessages(sessionId as string),
    enabled: !!sessionId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

// Map persisted rows → the ChatItems the conversation renders. Pure + unit-tested.
//   • user turn with meta.tools  → one tool ChatItem per line (a tool_result/deny turn).
//   • user turn (string content) → a user bubble (meta.display ?? content, so a seed-folded turn
//     shows the bare words the user typed, not the seed-wrapped version).
//   • assistant turn with text   → one assistant bubble (splitReply runs at render).
//   • assistant turn (tool_use only) / repair turn → nothing user-visible.
export function rowsToChatItems(rows: ChatMessageRow[]): ChatItem[] {
  const items: ChatItem[] = []
  for (const r of rows) {
    // A server-seeded framing turn (a proactive session's hidden context) primes the model only —
    // never rendered. The server keeps it in the model window; the person never sees it.
    if (r.meta?.hidden) continue
    if (r.role === 'user') {
      // A user bubble, THEN any tool lines — the two are independent so a deny-with-note turn shows
      // both the note (meta.display) and the "Declined." line. meta.display (seed bare words / typed
      // decline note) wins over the raw content; a plain text turn falls back to the string content.
      if (r.meta?.display) {
        items.push({ id: `m${r.seq}`, role: 'user', text: r.meta.display })
      } else if (typeof r.content === 'string') {
        items.push({ id: `m${r.seq}`, role: 'user', text: r.content })
      }
      r.meta?.tools?.forEach((t, i) =>
        items.push({ id: `m${r.seq}-t${i}`, role: 'tool', text: t.text, ok: t.ok }),
      )
    } else {
      const text = assistantText(r.content)
      if (text) items.push({ id: `m${r.seq}`, role: 'assistant', text })
    }
  }
  return items
}
