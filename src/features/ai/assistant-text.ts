// The one way to read an assistant turn's words out of stored content. Its own module, deliberately:
// both the transcript mapper (use-chat-messages, which pulls in Supabase) and the list's preview line
// (chat-preview, which must stay import-clean so it can be tested without env vars) need it, and
// neither should have to import the other to get it.

interface AssistantBlock {
  type?: string
  text?: string
}

// Concatenate an assistant turn's text blocks (skip tool_use/other blocks). Defensive against a
// string content (shouldn't happen for assistant, but never throw on a stored row).
export function assistantText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as AssistantBlock[])
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
}
