// chat-driver.ts — scripted multi-turn conversations against the REAL ai-chat edge function.
//
// Speaks exactly the protocol the app's client speaks (use-ai-chat.ts is the reference impl):
// one POST per turn — a new `message`, or a confirm/deny `action` on the pending destructive
// tool — parsing the `data: {json}\n\n` SSE stream. The only cross-POST state is the session_id
// (first event of the first turn) and the pending tool_use_id (from tool-pending-confirmation).
// Errors after the stream starts are IN-BAND ({type:'error'}); HTTP status only gates pre-stream.
//
// The [[status:]] marker is split off with the app's own parser (src/features/ai/reply-status.ts,
// imported directly — dependency-free), so judge/checks see body and status the way the UI does.

import { splitReply } from '../../src/features/ai/reply-status.ts'
import type { ChatTrace, ToolResultRec, ToolUseRec, Turn, TurnTrace } from './types.ts'

export interface ChatEndpoint {
  apiUrl: string
  anonKey: string
  token: string
}

/** Incremental SSE parser (exported for self-tests): feed decoded chunks, collect events. */
export class SseAccumulator {
  private buf = ''
  readonly events: Array<Record<string, unknown>> = []

  push(chunk: string): void {
    this.buf += chunk
    const frames = this.buf.split('\n\n')
    this.buf = frames.pop() ?? ''
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          this.events.push(JSON.parse(line.slice(6)) as Record<string, unknown>)
        } catch {
          this.events.push({ type: 'parse-error', raw: line.slice(6, 200) })
        }
      }
    }
  }
}

/** Fold a turn's raw SSE events into the TurnTrace shape checks/judges consume. */
export function foldTurn(input: Turn, events: Array<Record<string, unknown>>): TurnTrace {
  let text = ''
  const toolUses: ToolUseRec[] = []
  const toolResults: ToolResultRec[] = []
  let pending: TurnTrace['pending'] = null
  let stopReason: string | null = null
  let error: TurnTrace['error'] = null
  let sessionId: string | null = null

  for (const ev of events) {
    switch (ev.type) {
      case 'session':
        sessionId = ev.session_id as string
        break
      case 'text-delta':
        text += ev.text as string
        break
      case 'message': {
        const content = ev.content as Array<Record<string, unknown>> | undefined
        for (const block of content ?? []) {
          if (block.type === 'tool_use') {
            toolUses.push({
              id: block.id as string,
              name: block.name as string,
              input: block.input,
            })
          }
        }
        break
      }
      case 'tool-result':
        toolResults.push({
          tool_use_id: ev.tool_use_id as string,
          name: ev.name as string,
          ok: Boolean(ev.ok),
          summary: String(ev.summary ?? ''),
          display: ev.display as string | null | undefined,
          mutated: ev.mutated as string[] | undefined,
        })
        break
      case 'tool-pending-confirmation':
        pending = {
          tool_use_id: ev.tool_use_id as string,
          name: ev.name as string,
          summary: String(ev.summary ?? ''),
        }
        break
      case 'done':
        stopReason = (ev.stop_reason as string) ?? null
        break
      case 'error':
        error = { code: ev.code as string | undefined, message: ev.message as string | undefined }
        break
    }
  }

  const split = splitReply(text)
  const trace: TurnTrace = {
    input,
    events,
    text,
    body: split.body,
    status: split.status,
    needsInput: split.needsInput,
    toolUses,
    toolResults,
    pending,
    stopReason,
    error,
  }
  // stash session id for the driver (not part of the public shape)
  ;(trace as TurnTrace & { _sessionId?: string | null })._sessionId = sessionId
  return trace
}

export async function driveChat(ep: ChatEndpoint, turns: Turn[]): Promise<ChatTrace> {
  let sessionId: string | null = null
  let pendingId: string | null = null
  const out: TurnTrace[] = []

  for (const turn of turns) {
    let body: Record<string, unknown>
    if ('say' in turn) {
      body = { session_id: sessionId, message: turn.say, ...(turn.seed ? { seed: turn.seed } : {}) }
    } else {
      if (!sessionId || !pendingId) {
        out.push(
          foldTurn(turn, [
            { type: 'error', code: 'harness', message: 'confirm/deny turn with nothing pending' },
          ]),
        )
        break
      }
      body =
        'confirm' in turn
          ? { session_id: sessionId, action: { type: 'confirm', tool_use_id: pendingId } }
          : {
              session_id: sessionId,
              action: {
                type: 'deny',
                tool_use_id: pendingId,
                ...(turn.note ? { note: turn.note } : {}),
              },
            }
    }

    let events: Array<Record<string, unknown>>
    try {
      const res = await fetch(`${ep.apiUrl}/functions/v1/ai-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ep.anonKey,
          Authorization: `Bearer ${ep.token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      })
      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => '')
        events = [{ type: 'error', code: `http-${res.status}`, message: errBody.slice(0, 300) }]
      } else {
        const acc = new SseAccumulator()
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          acc.push(decoder.decode(value, { stream: true }))
        }
        events = acc.events
      }
    } catch (e) {
      events = [{ type: 'error', code: 'fetch', message: String(e).slice(0, 300) }]
    }

    const trace = foldTurn(turn, events)
    sessionId = (trace as TurnTrace & { _sessionId?: string | null })._sessionId ?? sessionId
    pendingId = trace.pending?.tool_use_id ?? null
    out.push(trace)
    if (trace.error && trace.error.code?.startsWith('http-')) break
  }

  return { sessionId, turns: out }
}
