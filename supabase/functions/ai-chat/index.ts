// ai-chat — the streaming, tool-using chat. The conversation is now SERVER-AUTHORITATIVE and durable
// (ADR 2026-07-13-persistent-chats): the client no longer holds or resends history. Each request is a
// single new user `message` (optionally with a deep-link `seed`) OR a confirm/deny `action` on a
// pending destructive tool, always scoped to a `session_id` (null = create a new session). The server
// loads a windowed transcript from the DB, runs the agentic loop until end_turn OR until a DESTRUCTIVE
// tool needs confirmation (halt), and PERSISTS every turn as it goes.
//
// Two DB handles (see ADR): all TOOL writes (tasks/habits/memories) use the caller JWT (RLS; the model
// never supplies user_id). Transcript persistence uses a service_role admin client that only calls the
// chat_* DEFINER RPCs — the browser has NO write path to the chat tables, so an assistant turn cannot
// be forged. The confirm/deny protocol validates against the SERVER-recorded `pending`, never
// client-echoed state, and answers every unanswered tool_use in the halted turn (deny + on-load repair)
// so a resume can never leave a dangling tool_use that 400s at the Anthropic API.

import type Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import { z } from 'npm:zod@4.4.3'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { userClient, adminClient, requireUser } from '../_shared/auth.ts'
import { anthropic, MODEL, MAX_TOKENS } from '../_shared/anthropic.ts'
import { precheck, recordUsage } from '../_shared/guardrails.ts'
import { SseWriter } from '../_shared/sse.ts'
import {
  TOOL_DEFS,
  DESTRUCTIVE,
  executeTool,
  destructiveSummary,
  type ToolContext,
  type ToolResult,
} from '../_shared/chat-tools.ts'
import { buildSystem } from '../_shared/chat-prompt.ts'
import { loadChatContext } from '../_shared/chat-context.ts'
import { runPlanForUser } from '../_shared/run-plan.ts'
import {
  MEMORY_TOOL_NAMES,
  MEMORY_WRITE_TOOL_NAMES,
  MAX_MEMORY_WRITES_PER_REQUEST,
} from '../_shared/capabilities/memories.ts'
import {
  loadSession,
  loadWindow,
  startSession,
  appendMessage,
  setPending,
  mergeConsecutive,
  repairDangling,
  buildDenyResults,
  haltedToolUseIds,
  deriveTitle,
  type Msg,
  type PendingState,
  type ToolLine,
} from '../_shared/chat-store.ts'

const MAX_TOOL_ITERATIONS = 8 // per HTTP request — bounds runaway tool loops (and budget burn)
const MAX_USER_MESSAGE_CHARS = 4000 // cap a single user turn (bounds token cost + abuse)

// Fully typed request — no `z.array(z.any())`, so the client can never inject Anthropic blocks (no
// forged tool_use, no self-supplied approvals). Exactly one of `message` | `action`; `seed` is
// deep-link context folded into the first turn; an `action` requires an existing session.
const BodySchema = z
  .object({
    session_id: z.string().uuid().nullish(), // null/absent = create a new session
    message: z.string().min(1).max(MAX_USER_MESSAGE_CHARS).optional(),
    seed: z.string().max(MAX_USER_MESSAGE_CHARS).optional(),
    action: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('confirm'), tool_use_id: z.string().max(200) }),
        z.object({
          type: z.literal('deny'),
          tool_use_id: z.string().max(200),
          note: z.string().max(MAX_USER_MESSAGE_CHARS).optional(),
        }),
      ])
      .optional(),
  })
  .refine((b) => !!b.message !== !!b.action, 'exactly one of message | action')
  .refine((b) => !b.action || !!b.session_id, 'action requires session_id')

type ToolUseBlock = Anthropic.ToolUseBlock

function lastAssistantToolUses(messages: Msg[]): ToolUseBlock[] | null {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return null
  const uses = last.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
  return uses.length ? uses : null
}

// The task/habit/memory id a destructive tool targets → its label, for the confirmation summary.
function summaryLabelId(input: unknown): string {
  const i = input as { task_id?: string; habit_id?: string; memory_id?: string }
  return i?.task_id ?? i?.habit_id ?? i?.memory_id ?? ''
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

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await req.json())
  } catch {
    return jsonErr({ error: 'invalid_request' }, 400)
  }

  // One rate-limit unit per HTTP request; budget kill-switch first.
  const gate = await precheck(client, 'chat')
  if (!gate.ok)
    return jsonErr({ error: gate.reason }, gate.reason === 'budget-exhausted' ? 503 : 429)

  // Rich per-request context (active + done-today tasks with grid position, habits with today's
  // check state, schedule summary, per-user assistant config) for the system prompt, plus a label
  // map (task/habit/memory id → text) for the destructive-confirmation summaries.
  const { context, timeZone, labelById, memoryEnabled } = await loadChatContext(client)
  const system = buildSystem(context)

  // Kill switch (primary enforcement): when memory is off the model never even SEES the memory tools.
  const tools = (memoryEnabled
    ? TOOL_DEFS
    : TOOL_DEFS.filter((t) => !MEMORY_TOOL_NAMES.has(t.name))) as unknown as Anthropic.Tool[]

  // Tool DB writes go through the caller JWT (RLS). Transcript persistence uses the admin client.
  const toolCtx: ToolContext = {
    client,
    timeZone,
    services: { generatePlan: () => runPlanForUser(client, timeZone) },
  }
  const admin = adminClient()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = new SseWriter(controller)
      let inTok = 0
      let outTok = 0
      const flushUsage = async () => {
        try {
          await recordUsage(client, gate.usageId, inTok, outTok, 'chat')
        } catch {
          /* bookkeeping is best-effort */
        }
      }

      try {
        // Constructed inside the stream so a missing key surfaces as an in-band error event
        // (graceful) rather than a pre-stream throw (HTTP 500).
        const a = anthropic()

        // --- Resolve the session + its working window (server-held, never client-supplied) ---
        let sessionId = body.session_id ?? null
        let messages: Msg[]
        let storedPending: PendingState | null = null

        if (sessionId) {
          const sess = await loadSession(client, sessionId) // RLS scopes this to the caller
          if (!sess) {
            sse.send({
              type: 'error',
              code: 'session_not_found',
              message: 'That chat is gone — start a new one.',
            })
            return sse.close()
          }
          storedPending = sess.pending
          messages = await loadWindow(client, sessionId)
        } else {
          const title = deriveTitle(body.seed ?? body.message ?? '')
          try {
            sessionId = await startSession(admin, user.id, title || null)
          } catch (e) {
            if (String((e as { message?: string })?.message).includes('chat_session_cap_reached')) {
              sse.send({
                type: 'error',
                code: 'too_many_chats',
                message: 'You have a lot of saved chats — delete some to start a new one.',
              })
              return sse.close()
            }
            throw e
          }
          messages = []
        }
        sse.send({ type: 'session', session_id: sessionId })

        // Approved tool_use ids for this halted turn (confirm resume), and the halted turn to process
        // first without a fresh model call. `pendingActive` tracks whether a `pending` row is set so
        // we clear it exactly once when we commit past the halt.
        let approved = new Set<string>()
        let pendingToolUses: ToolUseBlock[] | null = null
        let pendingActive = storedPending != null

        if (body.action) {
          // Resume: validate against the SERVER-recorded pending, never client-echoed state.
          const halted = lastAssistantToolUses(messages)
          if (
            !storedPending ||
            storedPending.awaiting.tool_use_id !== body.action.tool_use_id ||
            !halted
          ) {
            if (pendingActive) await setPending(admin, sessionId, user.id, null)
            sse.send({
              type: 'error',
              code: 'stale_confirmation',
              message: 'That was already handled — refresh to continue.',
            })
            return sse.close()
          }
          if (body.action.type === 'confirm') {
            approved = new Set(storedPending.approved)
            approved.add(body.action.tool_use_id)
            pendingToolUses = halted // process the halted turn first, with the approved set
          } else {
            // Deny: answer the denied id + every sibling in the halted turn, persist, clear pending,
            // then let the model respond (with the user's note, if any).
            const results = buildDenyResults(
              haltedToolUseIds(messages),
              body.action.tool_use_id,
              body.action.note,
            )
            messages.push(results)
            await appendMessage(admin, sessionId, user.id, 'user', results.content, {
              tools: [{ text: 'Declined.', ok: false }],
            })
            await setPending(admin, sessionId, user.id, null)
            pendingActive = false
          }
        } else {
          // Message: heal any dangling tool_use (an interrupted prior turn) BEFORE the new message so
          // the window never replays an unanswered tool_use, then append the user turn.
          const healed = repairDangling(messages)
          messages = healed.messages
          if (healed.repair) {
            await appendMessage(admin, sessionId, user.id, 'user', healed.repair.content, null)
          }
          // A new message supersedes any pending confirmation — clear it.
          if (pendingActive) {
            await setPending(admin, sessionId, user.id, null)
            pendingActive = false
          }
          const seedText = body.seed?.trim()
          const outgoing = seedText
            ? `(Context — the app sent me this: "${seedText}")\n\n${body.message}`
            : (body.message as string)
          messages.push({ role: 'user', content: outgoing } as Msg)
          // Store the bare user words as meta.display when a seed was folded, so history shows what
          // the user actually typed, not the seed-wrapped version.
          await appendMessage(
            admin,
            sessionId,
            user.id,
            'user',
            outgoing,
            seedText ? { display: body.message as string } : null,
          )
        }

        // Per-request memory-write brake (junk guard).
        let memoryWrites = 0

        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          let toolUses: ToolUseBlock[]

          if (pendingToolUses) {
            toolUses = pendingToolUses
            pendingToolUses = null
          } else {
            const ms = a.messages.stream({
              model: MODEL,
              max_tokens: MAX_TOKENS,
              system,
              messages: mergeConsecutive(messages), // fold any adjacent same-role turns for the API
              tools,
            })
            ms.on('text', (delta: string) => sse.send({ type: 'text-delta', text: delta }))
            const final = await ms.finalMessage()
            inTok += final.usage.input_tokens
            outTok += final.usage.output_tokens

            if (final.stop_reason !== 'tool_use') {
              messages.push({ role: 'assistant', content: final.content })
              await appendMessage(admin, sessionId, user.id, 'assistant', final.content, null)
              sse.send({ type: 'message', role: 'assistant', content: final.content })
              await flushUsage()
              sse.send({ type: 'done', stop_reason: final.stop_reason ?? 'end_turn' })
              return sse.close()
            }
            messages.push({ role: 'assistant', content: final.content })
            await appendMessage(admin, sessionId, user.id, 'assistant', final.content, null)
            toolUses = final.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
          }

          // Atomic pre-scan: if ANY destructive tool in this turn is unconfirmed, halt and execute
          // NOTHING (so a resume never re-runs already-executed siblings). Persist the pending state.
          const needsConfirm = toolUses.find(
            (tu) => DESTRUCTIVE.has(tu.name) && !approved.has(tu.id),
          )
          if (needsConfirm) {
            const summary = destructiveSummary(
              needsConfirm.name,
              needsConfirm.input,
              labelById.get(summaryLabelId(needsConfirm.input)),
            )
            const pendingState: PendingState = {
              awaiting: { tool_use_id: needsConfirm.id, name: needsConfirm.name, summary },
              approved: [...approved],
            }
            await setPending(admin, sessionId, user.id, pendingState)
            pendingActive = true
            sse.send({
              type: 'tool-pending-confirmation',
              tool_use_id: needsConfirm.id,
              name: needsConfirm.name,
              summary,
            })
            await flushUsage()
            sse.send({ type: 'done', stop_reason: 'awaiting-confirmation' })
            return sse.close()
          }

          // All clear — we're committing this turn, so drop any pending row exactly once.
          if (pendingActive) {
            await setPending(admin, sessionId, user.id, null)
            pendingActive = false
          }

          const results: Anthropic.ToolResultBlockParam[] = []
          const toolLines: ToolLine[] = []
          for (const tu of toolUses) {
            let res: ToolResult
            if (MEMORY_WRITE_TOOL_NAMES.has(tu.name)) {
              if (memoryWrites >= MAX_MEMORY_WRITES_PER_REQUEST) {
                res = {
                  content:
                    'Memory write limit for this turn reached — save at most a couple per turn.',
                  is_error: true,
                  display: null,
                }
              } else {
                memoryWrites++
                res = await executeTool(tu.name, tu.input, toolCtx)
              }
            } else {
              res = await executeTool(tu.name, tu.input, toolCtx)
            }
            sse.send({
              type: 'tool-result',
              tool_use_id: tu.id,
              name: tu.name,
              ok: !res.is_error,
              summary: res.content, // model-facing (persisted into the turn)
              display: res.display, // user-facing chat line: undefined → reuse summary, null → hide
              mutated: res.mutated ?? [], // which data domains changed → client live-refresh
            })
            results.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: res.content,
              is_error: res.is_error,
            })
            // meta.tools mirrors what the USER saw (undefined → reuse summary; null → suppressed).
            const disp = res.display === undefined ? res.content : res.display
            if (disp !== null) toolLines.push({ text: disp, ok: !res.is_error })
          }
          messages.push({ role: 'user', content: results } as Msg)
          await appendMessage(
            admin,
            sessionId,
            user.id,
            'user',
            results,
            toolLines.length ? { tools: toolLines } : null,
          )
        }

        // Hit the iteration cap.
        await flushUsage()
        sse.send({ type: 'error', code: 'tool-loop-cap', message: 'Too many tool steps.' })
        sse.close()
      } catch (e) {
        // Log the real error server-side; the client still needs an error event to stop the
        // stream, but the human-readable text stays generic (no internal detail disclosure).
        console.error('ai-chat failed:', e)
        await flushUsage()
        sse.send({
          type: 'error',
          code: 'chat_failed',
          message: 'Chat failed, please retry.',
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
