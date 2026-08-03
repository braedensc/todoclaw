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
// `origin` distinguishes a person-started chat ('user') from one materialised from an inbox message
// ('proactive', BabyClaw-initiated); `kind` carries the proactive message type for the collar tag +
// unified-history grouping. Both default defensively so an older row (pre-consolidation) reads as a
// plain user chat.
export const ChatSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  updated_at: z.string(),
  origin: z.enum(['user', 'proactive']).catch('user'),
  kind: z.enum(['plan', 'recap', 'reminder']).nullable().catch(null),
  local_date: z.string().nullable().catch(null), // the proactive message's local day (for the day-stamped tag)
  pending: ChatPendingSchema.nullable().catch(null), // tolerate a legacy/partial shape
})
export type ChatSession = z.infer<typeof ChatSessionSchema>

// A message's UI-only sidecar, written by the server: bare user words for a seed turn, per-tool
// display lines for a tool_result turn. Read defensively — a legacy/partial shape degrades to null
// rather than wedging the row.
export const ChatMessageMetaSchema = z
  .object({
    display: z.string().optional(),
    tools: z.array(z.object({ text: z.string(), ok: z.boolean() })).optional(),
    // A server-seeded context turn that primes the model but is never shown to the person (the
    // hidden framing turn a proactive/inbox session opens with). rowsToChatItems skips it.
    hidden: z.boolean().optional(),
  })
  .nullable()
  .catch(null)
export type ChatMessageMeta = z.infer<typeof ChatMessageMetaSchema>

// One persisted message. `content` is the raw Anthropic MessageParam content (string | block[]);
// both it and `meta` are read defensively (unknown) — the mapper shapes them.
export const ChatMessageRowSchema = z.object({
  seq: z.number(),
  role: z.enum(['user', 'assistant']),
  content: z.unknown(),
  meta: ChatMessageMetaSchema,
})
export type ChatMessageRow = z.infer<typeof ChatMessageRowSchema>

// One row of the chat-list preview read (chat_list_previews): the last USER-VISIBLE message of a
// session plus how many user-visible messages it holds. Server-seeded hidden framing turns are
// excluded by the RPC, so `msg_count` is what the person would actually count on screen — 1 for a
// check-in they have only received, >1 once they have replied.
export const ChatPreviewSchema = z.object({
  session_id: z.string().uuid(),
  msg_count: z.number(),
  last_role: z.enum(['user', 'assistant']),
  last_content: z.unknown(),
  last_meta: ChatMessageMetaSchema,
})
export type ChatPreview = z.infer<typeof ChatPreviewSchema>
