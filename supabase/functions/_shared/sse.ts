// Server-Sent Events for the streaming chat. Each event is a typed JSON line
// (`data: {...}\n\n`). The function writes events into a ReadableStream; the frontend reads
// them incrementally. The error event is in-band (HTTP stays 200) so partial text can stream
// before a failure.

export type SseEvent =
  | { type: 'text-delta'; text: string }
  | {
      type: 'tool-result'
      tool_use_id: string
      name: string
      ok: boolean
      // Model-facing tool_result content (may carry ids / JSON). The client pairs THIS back into
      // its held history on a destructive resume — never render it to the user directly.
      summary: string
      // What the USER sees in the chat activity line, kept free of ids / raw JSON. Omitted →
      // reuse `summary` (fine when it's already a plain sentence); null → an internal lookup we
      // don't surface at all (no bubble).
      display?: string | null
      // Data domains this tool changed ('tasks' | 'habits' | 'daily_state' | 'history'); the
      // client invalidates the matching TanStack Query keys so the UI live-refreshes.
      mutated?: string[]
    }
  | {
      type: 'tool-pending-confirmation'
      tool_use_id: string
      name: string
      input: unknown
      summary: string
      messages: unknown[]
    }
  | {
      type: 'message'
      role: 'assistant'
      content: unknown
      // The server's FULL authoritative message array for the turn — BabyClaw's own
      // tool_use/tool_result turns included (#245). The client adopts it wholesale so its next
      // resend carries what the assistant actually did. Absent on a response with no history sync.
      history?: unknown[]
    }
  | { type: 'done'; stop_reason: string }
  | { type: 'error'; code: string; message?: string }

const encoder = new TextEncoder()

export function encodeEvent(event: SseEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
}

export class SseWriter {
  private closed = false
  constructor(private controller: ReadableStreamDefaultController<Uint8Array>) {}
  send(event: SseEvent): void {
    if (this.closed) return
    this.controller.enqueue(encodeEvent(event))
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.controller.close()
  }
}
