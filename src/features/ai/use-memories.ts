import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { AssistantMemorySchema, type AssistantMemory } from '../../types/assistant-memory'

// The Settings → AI memory list data layer. Every op is a plain RLS-scoped table call under the
// caller's JWT — no RPC, no user_id ever sent. The KEY matches DOMAIN_QUERY_KEYS.memories in
// use-ai-chat.ts, so a memory BabyClaw saves/updates/deletes in chat live-refreshes this list too.
export const MEMORIES_KEY = ['assistant_memories'] as const

async function fetchMemories(): Promise<AssistantMemory[]> {
  const { data, error } = await supabase
    .from('assistant_memories')
    .select('id, content, created_at, updated_at')
    .order('created_at', { ascending: false }) // newest-first in the UI
  if (error) throw error
  return AssistantMemorySchema.array().parse(data)
}

export function useMemories() {
  return useQuery({ queryKey: MEMORIES_KEY, queryFn: fetchMemories })
}

// Edit a memory's text. RLS scopes the update to the caller's own row; the DB CHECK/dedup index
// still guard length + duplicates (surfaced to the caller as an error → the UI's onError toast).
export function useUpdateMemory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const { error } = await supabase.from('assistant_memories').update({ content }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MEMORIES_KEY }),
  })
}

// Forget one memory (hard delete, RLS-scoped).
export function useDeleteMemory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('assistant_memories').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MEMORIES_KEY }),
  })
}

// Forget everything. PostgREST refuses an unfiltered DELETE, so pass a filter that matches all of
// the caller's own rows (id is a non-null PK); RLS confines it to their memories.
export function useDeleteAllMemories() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('assistant_memories').delete().not('id', 'is', null)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MEMORIES_KEY }),
  })
}
