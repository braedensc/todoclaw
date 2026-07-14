// Server-Sent Events for the streaming chat. Each event is a typed JSON line
// (`data: {...}\n\n`). The function writes events into a ReadableStream; the frontend reads
// them incrementally. The error event is in-band (HTTP stays 200) so partial text can stream
// before a failure.

export type SseEvent =
  // Which session this turn belongs to — emitted first, so the client adopts the id of a session it
  // just created (session_id was null) and can refetch its persisted messages.
  | { type: 'session'; session_id: string }
  | { type: 'text-delta'; text: string }
  | {
      type: 'tool-result'
      tool_use_id: string
      name: string
      ok: boolean
      // Model-facing tool_result content (may carry ids / JSON) — server-persisted into the turn.
      // Never rendered to the user directly.
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
      // A destructive tool paused for the user's confirm/deny. The client answers with an
      // { action: 'confirm' | 'deny', tool_use_id } request — it never echoes history back.
      type: 'tool-pending-confirmation'
      tool_use_id: string
      name: string
      summary: string
    }
  // The assistant turn committed (transcript is persisted server-side). `content` lets the client
  // finalize its live bubble; there is no history to adopt (the client refetches from the DB).
  | { type: 'message'; role: 'assistant'; content: unknown }
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
