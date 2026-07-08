// BabyClaw ends every reply with a machine-read status line — `[[status: <tight summary>]]` on
// the final line (instructed in chat-prompt.ts SYSTEM_PREFIX). The chat drawer hides that line
// from the bubble; the add-widget one-liner shows it INSTEAD of raw reply text, so the compact
// surface gets a model-authored "what happened / what's needed" summary with BabyClaw's voice.
// Parsing is forgiving: `status:` is optional, and a marker the stream has opened but not yet
// closed (`[[stat…` at the tail) is hidden too so it never flashes in the drawer mid-stream.

const COMPLETE = /\s*\[\[\s*(?:status:\s*)?([^\]]*?)\s*\]\]\s*$/i

export interface SplitReply {
  /** The reply with any trailing status marker (complete or mid-stream) removed. */
  body: string
  /** The extracted status text, or null when the reply carries no (complete) marker. */
  status: string | null
}

export function splitReply(text: string): SplitReply {
  const m = text.match(COMPLETE)
  if (m) {
    return { body: text.slice(0, m.index).trimEnd(), status: m[1]!.trim() || null }
  }
  // Mid-stream: a marker opened at the tail but not yet closed — hide it, no status yet.
  const open = text.lastIndexOf('[[')
  if (open !== -1 && !text.slice(open).includes(']]')) {
    return { body: text.slice(0, open).trimEnd(), status: null }
  }
  return { body: text, status: null }
}
