// BabyClaw ends every reply with a machine-read status line — `[[status: <tight summary>]]` on
// the final line (instructed in chat-prompt.ts SYSTEM_PREFIX). The chat drawer hides that line
// from the bubble; the add-widget one-liner shows it INSTEAD of raw reply text, so the compact
// surface gets a model-authored "what happened / what's needed" summary with BabyClaw's voice.
// Parsing is forgiving: `status:` is optional, and a marker the stream has opened but not yet
// closed (`[[stat…` at the tail) is hidden too so it never flashes in the drawer mid-stream.
//
// A status that begins with `? ` is the WAITING marker (same prompt): BabyClaw stopped and needs
// the user's answer before anything happens. The `?` is stripped from the shown text and surfaces
// as `needsInput`, which the Task Manager widget turns into its can't-miss "waiting on you"
// treatment. Detection is belt-and-suspenders: the explicit marker, or a reply that plainly ends
// on a question (older conversations / a forgetful model).

// The status text may itself contain a single `]` (e.g. a task named "read [ch 3]" echoed into the
// status) — so the capture excludes NEWLINES, not `]`. The marker is always the reply's last line, so
// barring newlines keeps the match to that trailing line (an earlier `[[…]]` in the body can't reach
// the `]]$` across a newline), while `]` inside the status no longer defeats the strip.
const COMPLETE = /\s*\[\[\s*(?:status:\s*)?([^\n]*?)\s*\]\]\s*$/i

// Trailing decoration that can follow the actual question mark — BabyClaw signs off with 🐾, and
// quotes/brackets/!/… may trail a "…?" sentence. Stripped before the ends-with-? check.
const TRAILING_DECOR = /[\s🐾"'“”‘’)\]*_.!…]+$/u

/** Does this text plainly end on a question (ignoring 🐾/punctuation sign-off)? Exported so the
 *  status derivation can pick WHICH text (status vs body) to show as "the question". */
export function endsWithQuestion(text: string): boolean {
  return text.replace(TRAILING_DECOR, '').endsWith('?')
}

export interface SplitReply {
  /** The reply with any trailing status marker (complete or mid-stream) removed. */
  body: string
  /** The extracted status text (waiting marker stripped), or null when the reply carries no (complete) marker. */
  status: string | null
  /** BabyClaw is stopped, waiting on the user's answer — flagged (`[[status: ? …]]`) or a plain trailing question. */
  needsInput: boolean
}

export function splitReply(text: string): SplitReply {
  const m = text.match(COMPLETE)
  if (m) {
    const body = text.slice(0, m.index).trimEnd()
    const raw = m[1]!.trim()
    const flagged = raw.startsWith('?')
    const status = (flagged ? raw.replace(/^\?\s*/, '') : raw) || null
    return {
      body,
      status,
      needsInput:
        flagged || (status !== null && endsWithQuestion(status)) || endsWithQuestion(body),
    }
  }
  // Mid-stream: a marker opened at the tail but not yet closed — hide it, no status yet.
  const open = text.lastIndexOf('[[')
  if (open !== -1 && !text.slice(open).includes(']]')) {
    return { body: text.slice(0, open).trimEnd(), status: null, needsInput: false }
  }
  return { body: text, status: null, needsInput: endsWithQuestion(text) }
}
