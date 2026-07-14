// chat-store.ts — the SERVER-authoritative chat transcript: load a windowed message array from the
// DB, repair a dangling tool_use, and persist turns. The conversation is no longer client-held; the
// client only reads + deletes (RLS), and every write here goes through the service_role DEFINER RPCs
// (chat_start_session / chat_append_message / chat_set_pending, 20260713050000_chat_sessions.sql) so
// an assistant turn can never be forged from the browser.
//
// Two halves:
//   • PURE (unit-tested, no DB): rowsToMessages, windowMessages, repairDangling, buildDenyResults —
//     the Anthropic-shape bookkeeping (boundary cut, size cut, merge, answer-every-tool_use). These
//     are the correctness-critical, deno-tested pieces.
//   • DB (thin RPC wrappers over the admin client): startSession / appendMessage / setPending, plus
//     loadWindow / loadPending which read under the caller JWT (RLS doubles as the ownership check).

import type Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'

export type Msg = Anthropic.MessageParam

// Load the newest N messages for a window. Old context ages out of the PROMPT (the system prompt
// re-injects live task state fresh each turn); nothing is deleted.
export const WINDOW_LIMIT = 60
// Serialized-size ceiling for the replayed window (bounds token cost + matches the per-request cap).
export const WINDOW_MAX_CHARS = 50_000

// Answer stamped onto a tool_use that was interrupted (an aborted/failed resume) when a NEW message
// arrives — so the window never replays a dangling tool_use (which 400s at the Anthropic API).
const INTERRUPTED = 'Not executed — the previous turn was interrupted before this action ran.'

// ---- pending (halted-confirmation) state stored on chat_sessions.pending -----------------------

export interface PendingAwaiting {
  tool_use_id: string
  name: string
  summary: string
}
export interface PendingState {
  awaiting: PendingAwaiting
  approved: string[] // tool_use ids already confirmed this halted turn (multi-destructive support)
}

// ---- UI sidecar (chat_messages.meta) — never sent to the model -----------------------------------

export interface ToolLine {
  text: string
  ok: boolean
}
export interface MessageMeta {
  // The bare user words for a seed-folded user turn (content carries the seed-wrapped version).
  display?: string
  // Per-tool display lines for a tool_result turn (only tools whose display wasn't suppressed).
  tools?: ToolLine[]
}

// ---- stored-row shape ---------------------------------------------------------------------------

export interface ChatMessageRow {
  seq: number
  role: unknown
  content: unknown
  meta?: unknown
}

// ---- structural block helpers (the SDK's content types are loose unions; check structurally) -----

interface Block {
  type?: string
  id?: string
  tool_use_id?: string
}
function blocks(content: unknown): Block[] {
  return Array.isArray(content) ? (content as Block[]) : []
}
function toolUseIds(m: Msg): string[] {
  if (m.role !== 'assistant') return []
  return blocks(m.content)
    .filter((b) => b.type === 'tool_use' && typeof b.id === 'string')
    .map((b) => b.id as string)
}
function hasToolResult(m: Msg): boolean {
  return m.role === 'user' && blocks(m.content).some((b) => b.type === 'tool_result')
}
// A clean window start: a user turn that is NOT answering a prior tool_use (a leading tool_result
// would reference a tool_use that got windowed out → orphaned → API 400).
function isCleanUserStart(m: Msg): boolean {
  return m.role === 'user' && !hasToolResult(m)
}

// ---- pure: rows → messages ----------------------------------------------------------------------

// Shape each stored row into an Anthropic MessageParam; drop malformed rows (with a server log) so a
// single corrupt row can't wedge the whole conversation.
export function rowsToMessages(rows: ChatMessageRow[]): Msg[] {
  const out: Msg[] = []
  for (const r of rows) {
    if (r.role !== 'user' && r.role !== 'assistant') {
      console.error('chat-store: dropping row with bad role', r.seq)
      continue
    }
    if (r.content == null) {
      console.error('chat-store: dropping row with null content', r.seq)
      continue
    }
    out.push({ role: r.role, content: r.content } as Msg)
  }
  return out
}

// ---- pure: windowing ----------------------------------------------------------------------------

function toBlocks(content: unknown): Block[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content } as Block] : []
  return blocks(content)
}

// Merge adjacent same-role messages into one (Anthropic tolerates a single turn holding a
// tool_result array followed by text — the repair-then-new-message case produces exactly that).
export function mergeConsecutive(messages: Msg[]): Msg[] {
  const out: Msg[] = []
  for (const m of messages) {
    const prev = out[out.length - 1]
    if (prev && prev.role === m.role) {
      prev.content = [...toBlocks(prev.content), ...toBlocks(m.content)] as Msg['content']
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}

// Cut the window so it (1) starts on a clean user turn — never orphaning a tool_result whose tool_use
// aged out — and (2) serializes under WINDOW_MAX_CHARS, dropping whole oldest turns and re-cleaning
// the leading boundary after each drop. Then merge consecutive same-role turns.
export function windowMessages(messages: Msg[], maxChars: number = WINDOW_MAX_CHARS): Msg[] {
  let work = messages.slice()
  const dropLeadingUntilCleanStart = () => {
    while (work.length && !isCleanUserStart(work[0])) work.shift()
  }
  dropLeadingUntilCleanStart()
  while (work.length && JSON.stringify(work).length > maxChars) {
    work.shift() // drop the oldest whole turn
    dropLeadingUntilCleanStart() // dropping one may have exposed an orphaned tool_result
  }
  return mergeConsecutive(work)
}

// ---- pure: dangling tool_use repair -------------------------------------------------------------

// If the LAST message is an assistant turn with tool_use blocks that nothing answers (a halted or
// interrupted turn), return those ids; else null.
export function danglingToolUseIds(messages: Msg[]): string[] | null {
  const last = messages[messages.length - 1]
  if (!last) return null
  const ids = toolUseIds(last)
  return ids.length ? ids : null
}

function toolResultBlock(id: string, content: string, isError: boolean): Block {
  return { type: 'tool_result', tool_use_id: id, content, is_error: isError } as Block
}

// Build a user turn that answers a set of tool_use ids, optionally with a trailing text block. Every
// tool_use in a halted turn MUST be answered in the single next user message or the API 400s.
function toolResultTurn(
  answers: { id: string; content: string; isError: boolean }[],
  note?: string,
): Msg {
  const content: Block[] = answers.map((a) => toolResultBlock(a.id, a.content, a.isError))
  const trimmed = note?.trim()
  if (trimmed) content.push({ type: 'text', text: trimmed } as Block)
  return { role: 'user', content } as Msg
}

// Heal a dangling tool_use before a NEW user message: answer every unanswered id as "interrupted".
// Returns the extended messages + the repair turn to persist (null when nothing was dangling).
export function repairDangling(messages: Msg[]): { messages: Msg[]; repair: Msg | null } {
  const ids = danglingToolUseIds(messages)
  if (!ids) return { messages, repair: null }
  const repair = toolResultTurn(ids.map((id) => ({ id, content: INTERRUPTED, isError: true })))
  return { messages: [...messages, repair], repair }
}

// Build the tool_result turn for a DENY: the denied id → "User declined"; every sibling in the same
// halted turn → "not executed, a sibling was declined". The note (the user's typed words) rides along
// as a text block so the model can act on "no, make it Friday instead".
export function buildDenyResults(haltedIds: string[], deniedId: string, note?: string): Msg {
  const answers = haltedIds.map((id) => ({
    id,
    content:
      id === deniedId
        ? 'User declined this action.'
        : 'Not executed — a sibling action in the same turn was declined.',
    isError: true,
  }))
  return toolResultTurn(answers, note)
}

// The tool_use ids in the last (halted) assistant turn — used to answer every sibling on deny.
export function haltedToolUseIds(messages: Msg[]): string[] {
  return danglingToolUseIds(messages) ?? []
}

// ---- DB: reads (caller JWT — RLS is the ownership check) ----------------------------------------

// Load the session's pending state (and confirm it belongs to the caller). Returns undefined when the
// session isn't the caller's (or doesn't exist), so callers can 404.
export async function loadSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<{ pending: PendingState | null } | undefined> {
  const { data } = await client
    .from('chat_sessions')
    .select('pending')
    .eq('id', sessionId)
    .maybeSingle()
  if (!data) return undefined
  return { pending: (data.pending as PendingState | null) ?? null }
}

// Load + window the newest messages for a session (oldest-first, boundary/size cut, merged).
export async function loadWindow(client: SupabaseClient, sessionId: string): Promise<Msg[]> {
  const { data } = await client
    .from('chat_messages')
    .select('seq, role, content, meta')
    .eq('session_id', sessionId)
    .order('seq', { ascending: false })
    .limit(WINDOW_LIMIT)
  const ordered = ((data ?? []) as ChatMessageRow[]).slice().reverse() // oldest-first
  return windowMessages(rowsToMessages(ordered))
}

// ---- DB: writes (service_role admin client — the DEFINER RPCs) ----------------------------------

export async function startSession(
  admin: SupabaseClient,
  userId: string,
  title: string | null,
): Promise<string> {
  const { data, error } = await admin.rpc('chat_start_session', {
    p_user_id: userId,
    p_title: title,
  })
  if (error) throw error
  return data as string
}

export async function appendMessage(
  admin: SupabaseClient,
  sessionId: string,
  userId: string,
  role: 'user' | 'assistant',
  content: unknown,
  meta?: MessageMeta | null,
): Promise<void> {
  const { error } = await admin.rpc('chat_append_message', {
    p_session: sessionId,
    p_user_id: userId,
    p_role: role,
    p_content: content,
    p_meta: meta ?? null,
  })
  if (error) throw error
}

export async function setPending(
  admin: SupabaseClient,
  sessionId: string,
  userId: string,
  pending: PendingState | null,
): Promise<void> {
  const { error } = await admin.rpc('chat_set_pending', {
    p_session: sessionId,
    p_user_id: userId,
    p_pending: pending,
  })
  if (error) throw error
}

// Derive a session title from the seed (deep-link) or first message: strip status markers, collapse
// whitespace, slice to a short length. Keeps raw [[status:]] / newlines out of the history list.
export function deriveTitle(raw: string): string {
  return raw
    .replace(/\[\[[^\n]*?\]\]/g, '') // any [[…]] marker (status etc.); [^\n] so a ] in text is kept
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}
