import { z } from 'zod'

// Boundary types for persistent BabyClaw chats (persistent-chats ADR). The transcript is
// server-authoritative: the client only READS these rows (+ hard-deletes its own). Writes go through
// service_role DEFINER RPCs in ai-chat, never PostgREST — so there is no client insert/update path.

// A halted destructive-tool confirmation, stored on chat_sessions.pending. `approved` accumulates
// across a multi-destructive turn so the confirm protocol doesn't livelock.
export const ChatPendingSchema = z.object({
  awaiting: z.object({
    tool_use_id: z.string(),
    name: z.string(),
    summary: z.string(),
  }),
  approved: z.array(z.string()).default([]),
})
export type ChatPending = z.infer<typeof ChatPendingSchema>

// A conversation row (the history list). `pending` is null unless a confirmation is mid-flight.
export const ChatSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  updated_at: z.string(),
  pending: ChatPendingSchema.nullable().catch(null), // tolerate a legacy/partial shape
})
export type ChatSession = z.infer<typeof ChatSessionSchema>

// One persisted message. `content` is the raw Anthropic MessageParam content (string | block[]);
// `meta` is a UI-only sidecar the server wrote (bare user words for a seed turn, per-tool display
// lines for a tool_result turn). Both are read defensively (unknown) — the mapper shapes them.
export const ChatMessageRowSchema = z.object({
  seq: z.number(),
  role: z.enum(['user', 'assistant']),
  content: z.unknown(),
  meta: z
    .object({
      display: z.string().optional(),
      tools: z.array(z.object({ text: z.string(), ok: z.boolean() })).optional(),
    })
    .nullable()
    .catch(null),
})
export type ChatMessageRow = z.infer<typeof ChatMessageRowSchema>
