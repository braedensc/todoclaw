// Server-Sent Events for the streaming chat. Each event is a typed JSON line
// (`data: {...}\n\n`). The function writes events into a ReadableStream; the frontend reads
// them incrementally. The error event is in-band (HTTP stays 200) so partial text can stream
// before a failure.

export type SseEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-result'; tool_use_id: string; name: string; ok: boolean; summary: string }
  | {
      type: 'tool-pending-confirmation'
      tool_use_id: string
      name: string
      input: unknown
      summary: string
      messages: unknown[]
    }
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
