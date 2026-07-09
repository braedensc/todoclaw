// Inline BabyClaw status derivation (batch-2 item 3). The BabyClaw input widget shows a single
// sub-line so a user understands what BabyClaw is doing WITHOUT opening the chat drawer. All the
// signals already exist client-side: `busy`/`pending`/`error` from the chat controller and the
// `tool` ChatItems it pushes (each carries the capability layer's short human summary + an `ok`
// flag). This pure function folds them into one { tone, icon, text, waiting } view so the
// derivation is testable in isolation from React.

import type { ChatItem, PendingConfirm } from '../ai/use-ai-chat'
import { endsWithQuestion, splitReply } from '../ai/reply-status'

export type BabyClawTone = 'idle' | 'busy' | 'pending' | 'done' | 'error' | 'paused'

export interface BabyClawStatus {
  tone: BabyClawTone
  /** Leading glyph for the line (✦ working/idle, ✓ done, ✕ error). */
  icon: string
  /**
   * The full inline line. Never pre-clamped — the widget's CSS `truncate` ellipsizes exactly at
   * the container edge, so the text uses ALL the available width first.
   */
  text: string
  /**
   * BabyClaw is STOPPED, waiting on the user — a destructive-tool confirmation or a question he
   * asked. The widget escalates this into its whole-frame "waiting on your reply" treatment.
   */
  waiting: boolean
}

const IDLE_HINT = 'Tell me a task in plain language — e.g. “vet appointment Friday, important”.'
const PAUSED_HINT = 'AI is paused this month — the planner still works without it.'

// A compact verb for the transient flash chip, pulled from a tool summary's leading word
// ("Created…" → "created", "Moved…" → "moved"). Capability summaries are authored to start with
// the action verb, so this needs no per-tool name map.
export function toolVerb(text: string): string {
  const w = text.trim().split(/\W+/).filter(Boolean)[0] ?? ''
  return w.toLowerCase()
}

export interface StatusInput {
  paused: boolean
  busy: boolean
  pending: PendingConfirm | null
  error: string | null
  items: ChatItem[]
}

// Priority ladder (highest first): paused → busy → awaiting-confirmation (answerable by typing
// yes/no right here — see use-ai-chat's pending-aware send) → stream/HTTP error → a reply that is
// waiting on the user's answer (the `[[status: ? …]]` marker or a plain trailing question — it
// outranks the tool outcome because BabyClaw acted and then STOPPED on a question) → the latest
// turn's outcome → idle hint. Within a turn, BabyClaw's own [[status: …]] line (a model-authored
// tight summary of the action taken / info needed) is preferred over raw tool or reply text; the
// tone still comes from the tool outcome so failures stay visibly ✕. Scoping to the latest turn
// keeps a stale success from an earlier turn from masking a fresh pure-reply turn.
export function deriveBabyClawStatus({
  paused,
  busy,
  pending,
  error,
  items,
}: StatusInput): BabyClawStatus {
  if (paused) return { tone: 'paused', icon: '✦', text: PAUSED_HINT, waiting: false }
  if (busy) return { tone: 'busy', icon: '✦', text: 'Working…', waiting: false }
  if (pending) return { tone: 'pending', icon: '✦', text: `${pending.summary}?`, waiting: true }
  if (error) return { tone: 'error', icon: '✕', text: error, waiting: false }

  const turn = latestTurn(items)
  const lastTool = findLast(turn, (i) => i.role === 'tool')
  const lastReply = findLast(turn, (i) => i.role === 'assistant')
  const reply = lastReply ? splitReply(lastReply.text) : null
  if (reply?.needsInput) {
    // Show the QUESTION itself: the status when it reads as one (or when the body doesn't ask
    // either — the "? "-flagged case), else the body sentence that asked.
    const text =
      reply.status && (endsWithQuestion(reply.status) || !endsWithQuestion(reply.body))
        ? reply.status
        : reply.body
    return { tone: 'pending', icon: '✦', text, waiting: true }
  }
  if (lastTool) {
    const tone = lastTool.ok === false ? 'error' : 'done'
    return {
      tone,
      icon: tone === 'error' ? '✕' : '✓',
      text: reply?.status ?? lastTool.text,
      waiting: false,
    }
  }
  if (reply) return { tone: 'idle', icon: '✦', text: reply.status ?? reply.body, waiting: false }
  return { tone: 'idle', icon: '✦', text: IDLE_HINT, waiting: false }
}

// The items produced in response to the most recent user message (everything after the last
// 'user' item). Empty when the conversation is fresh.
function latestTurn(items: ChatItem[]): ChatItem[] {
  let lastUser = -1
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]!.role === 'user') {
      lastUser = i
      break
    }
  }
  return items.slice(lastUser + 1)
}

function findLast<T>(arr: T[], pred: (x: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return arr[i]
  return undefined
}
