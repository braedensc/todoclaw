import { z } from 'zod'

// A durable fact BabyClaw saved about the user (assistant_memories). Written by the memory chat
// capabilities and curated by the user in Settings → AI. RLS scopes every row to the owner; the
// client never supplies user_id. Caps (240 chars, 30 rows, dedup) are DB-enforced — see
// supabase/migrations/20260713030000_assistant_memories.sql.
export const AssistantMemorySchema = z.object({
  id: z.string(),
  content: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type AssistantMemory = z.infer<typeof AssistantMemorySchema>

// Mirror of the server-side cap (capabilities/memories.ts MAX_MEMORY_CHARS + the DB CHECK) so the
// Settings editor can bound the textarea and pre-empt a rejected save.
export const MEMORY_CONTENT_MAX = 240
