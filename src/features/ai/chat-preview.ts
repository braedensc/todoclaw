import { splitReply } from './reply-status'
import { assistantText } from './assistant-text'
import type { ChatPreview } from '../../types/chat'

// Derives the one-line snippet under a chat's name in the "Your chats" list. Pure + unit-tested, and
// deliberately mirrors rowsToChatItems (use-chat-messages.ts): the preview must show the same words
// the transcript would, or the list lies about what a conversation said.
//
// Every import here must stay Supabase-free. lib/supabase THROWS on import without env vars, and CI
// has none — so so much as reaching it transitively (e.g. importing assistantText from the hook
// module rather than from ./assistant-text) fails this module's tests, and every test of anything
// that renders the list, on import alone.

/** Longest snippet we put in the DOM. CSS `truncate` does the visible ellipsis — this just keeps a
 *  4KB morning plan from riding along in 50 list rows to render ~40 visible characters. */
const PREVIEW_MAX = 160

/** Newlines and runs of spaces would render as ragged gaps on a single nowrap line. */
function flatten(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function clamp(s: string): string {
  return s.length > PREVIEW_MAX ? `${s.slice(0, PREVIEW_MAX).trimEnd()}…` : s
}

/**
 * Shape some of BabyClaw's prose into a list snippet: drop the machine-read `[[status: …]]` marker,
 * flatten to one line, clamp. Exported for the inbox rows — a check-in you haven't opened has no
 * session to read, so its own body IS its last message, and it must render identically to the way it
 * will once opening it materialises that same text as an assistant turn.
 */
export function assistantSnippet(text: string): string {
  return clamp(flatten(splitReply(text).body))
}

/**
 * The last user-visible words of a conversation, shaped for a single line.
 *
 * Mirrors how the transcript renders the same row:
 *   • assistant turn → BabyClaw's text, with the machine-read `[[status: …]]` marker stripped
 *     (splitReply) so the marker never leaks into the list. Unprefixed — the paw/bell already
 *     attributes it, and "BabyClaw:" on every row is noise.
 *   • user turn with tool lines → the last tool line. rowsToChatItems pushes the bubble THEN the tool
 *     lines, so the tool line is genuinely the last thing on screen for that turn.
 *   • user turn → the bare words typed (meta.display wins over seed-wrapped content), prefixed "You:"
 *     — the whole point is knowing at a glance who spoke last.
 *
 * Returns '' when a turn has nothing user-visible (e.g. a tool_use-only assistant turn); the caller
 * falls back to showing just the timestamp rather than an empty line.
 */
export function previewText(
  p: Pick<ChatPreview, 'last_role' | 'last_content' | 'last_meta'>,
): string {
  if (p.last_role === 'assistant') {
    return assistantSnippet(assistantText(p.last_content))
  }

  const tools = p.last_meta?.tools
  const lastTool = tools?.[tools.length - 1]
  if (lastTool) return clamp(flatten(lastTool.text))

  const typed = p.last_meta?.display ?? (typeof p.last_content === 'string' ? p.last_content : '')
  const flat = flatten(typed)
  return flat ? clamp(`You: ${flat}`) : ''
}
