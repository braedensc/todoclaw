// ai-chat — the streaming, tool-using chat. The conversation is CLIENT-HELD (Edge Functions are
// stateless): the client resends the full message history each turn. One HTTP request runs the
// agentic loop until end_turn OR until a DESTRUCTIVE tool needs confirmation, at which point it
// halts and returns the state to echo back. All tool DB writes go through the caller's JWT
// (RLS applies; model never supplies user_id). See ADR-0017.

import type Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import { z } from 'npm:zod@4.4.3'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { userClient, requireUser } from '../_shared/auth.ts'
import { anthropic, MODEL, MAX_TOKENS } from '../_shared/anthropic.ts'
import { precheck, recordUsage } from '../_shared/guardrails.ts'
import { SseWriter } from '../_shared/sse.ts'
import {
  TOOL_DEFS,
  DESTRUCTIVE,
  executeTool,
  destructiveSummary,
  type ToolContext,
} from '../_shared/chat-tools.ts'
import { buildSystem } from '../_shared/chat-prompt.ts'

const MAX_TOOL_ITERATIONS = 8 // per HTTP request — bounds runaway tool loops (and budget burn)
const MAX_MESSAGES = 100 // cap client-held history growth

const BodySchema = z.object({
  messages: z.array(z.any()).min(1).max(MAX_MESSAGES),
  approvedToolUseIds: z.array(z.string()).default([]),
})

type Msg = Anthropic.MessageParam
type ToolUseBlock = Anthropic.ToolUseBlock

function lastAssistantToolUses(messages: Msg[]): ToolUseBlock[] | null {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return null
  const uses = last.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
  return uses.length ? uses : null
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const cors = corsHeaders(req.headers.get('Origin'))
  const jsonErr = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  const client = userClient(req)
  const user = await requireUser(client)
  if (!user) return jsonErr({ error: 'unauthorized' }, 401)

  let body
  try {
    body = BodySchema.parse(await req.json())
  } catch {
    return jsonErr({ error: 'invalid_request' }, 400)
  }

  // One rate-limit unit per HTTP request; budget kill-switch first.
  const gate = await precheck(client, 'chat')
  if (!gate.ok)
    return jsonErr({ error: gate.reason }, gate.reason === 'budget-exhausted' ? 503 : 429)

  // Timezone (for complete_task) + a seeded grid snapshot for the system prompt.
  const { data: sched } = await client.from('user_schedule').select('timezone').maybeSingle()
  const timeZone = (sched?.timezone as string) ?? 'UTC'
  const { data: gridTasks } = await client
    .from('tasks')
    .select('id, text, staged, due')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  const system = buildSystem(gridTasks ?? [])
  const textById = new Map((gridTasks ?? []).map((t) => [t.id as string, t.text as string]))

  const toolCtx: ToolContext = { client, timeZone }
  const messages = body.messages as Msg[]
  const approved = new Set(body.approvedToolUseIds)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = new SseWriter(controller)
      let inTok = 0
      let outTok = 0
      const flushUsage = async () => {
        try {
          await recordUsage(client, gate.usageId, inTok, outTok)
        } catch {
          /* bookkeeping is best-effort */
        }
      }

      try {
        // Constructed inside the stream so a missing key surfaces as an in-band error event
        // (graceful) rather than a pre-stream throw (HTTP 500).
        const a = anthropic()
        // On a resume-after-confirmation request, the last message is the assistant tool_use turn
        // that we paused on — process it first (no new model call needed yet).
        let pending = lastAssistantToolUses(messages)

        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          let toolUses: ToolUseBlock[]

          if (pending) {
            toolUses = pending
            pending = null
          } else {
            const ms = a.messages.stream({
              model: MODEL,
              max_tokens: MAX_TOKENS,
              system,
              messages,
              tools: TOOL_DEFS as unknown as Anthropic.Tool[],
            })
            ms.on('text', (delta: string) => sse.send({ type: 'text-delta', text: delta }))
            const final = await ms.finalMessage()
            inTok += final.usage.input_tokens
            outTok += final.usage.output_tokens

            if (final.stop_reason !== 'tool_use') {
              sse.send({ type: 'message', role: 'assistant', content: final.content })
              await flushUsage()
              sse.send({ type: 'done', stop_reason: final.stop_reason ?? 'end_turn' })
              return sse.close()
            }
            messages.push({ role: 'assistant', content: final.content })
            toolUses = final.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
          }

          // Atomic pre-scan: if ANY destructive tool in this turn is unconfirmed, pause and
          // execute NOTHING (so a resume never re-runs already-executed siblings).
          const needsConfirm = toolUses.find(
            (tu) => DESTRUCTIVE.has(tu.name) && !approved.has(tu.id),
          )
          if (needsConfirm) {
            sse.send({
              type: 'tool-pending-confirmation',
              tool_use_id: needsConfirm.id,
              name: needsConfirm.name,
              input: needsConfirm.input,
              summary: destructiveSummary(
                needsConfirm.name,
                needsConfirm.input,
                textById.get((needsConfirm.input as { task_id?: string })?.task_id ?? ''),
              ),
              messages,
            })
            await flushUsage()
            sse.send({ type: 'done', stop_reason: 'awaiting-confirmation' })
            return sse.close()
          }

          // All clear — execute every tool in the turn (non-destructive + approved destructive).
          const results: Anthropic.ToolResultBlockParam[] = []
          for (const tu of toolUses) {
            const res = await executeTool(tu.name, tu.input, toolCtx)
            sse.send({
              type: 'tool-result',
              tool_use_id: tu.id,
              name: tu.name,
              ok: !res.is_error,
              summary: res.content,
            })
            results.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: res.content,
              is_error: res.is_error,
            })
          }
          messages.push({ role: 'user', content: results })
        }

        // Hit the iteration cap.
        await flushUsage()
        sse.send({ type: 'error', code: 'tool-loop-cap', message: 'Too many tool steps.' })
        sse.close()
      } catch (e) {
        await flushUsage()
        sse.send({
          type: 'error',
          code: 'chat_failed',
          message: e instanceof Error ? e.message : 'unknown',
        })
        sse.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...cors,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})
