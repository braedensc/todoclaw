import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// A mutating tool reports which data DOMAINS it changed; each maps to the TanStack Query key that
// owns that data, so acting in chat refreshes the grid / list / habits / Done tab INSTANTLY (no
// reload, no realtime round-trip). daily_state queries are keyed ['daily_state', date]; the bare
// ['daily_state'] prefix invalidates them all. Unknown domains are ignored.
const DOMAIN_QUERY_KEYS: Record<string, readonly unknown[]> = {
  tasks: ['tasks'],
  habits: ['habits'],
  daily_state: ['daily_state'],
  history: ['history'],
}

// Streaming chat over the ai-chat Edge Function. functions.invoke() doesn't expose streams, so
// we fetch() directly with the user's access token and read the SSE body. The conversation is
// CLIENT-HELD: we keep the Anthropic message history in a ref and resend it each turn. Destructive
// tools pause for confirmation — confirm() re-sends with the approved id and the executed
// tool_result is mirrored back into the held history (the server appends it to its local copy
// only, never over the wire); deny() feeds a declined tool_result back so the model continues
// gracefully. Either way every tool_use we hold stays paired — a dangling one 400s at the API.

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// What the UI renders. Tool activity shows as compact notes between bubbles.
export interface ChatItem {
  id: string
  role: 'user' | 'assistant' | 'tool'
  text: string
  ok?: boolean
}

export interface PendingConfirm {
  toolUseId: string
  summary: string
}

// Minimal Anthropic message shapes we construct client-side.
type AnyMsg = { role: 'user' | 'assistant'; content: unknown }

let counter = 0
const nextId = () => `c${counter++}`

// After a confirmation, the server executes the tool and appends the tool_result user turn to
// its LOCAL copy of the conversation only — it is never re-echoed. When the history we hold ends
// with the halted assistant tool_use turn (the confirm-resume case), pair the result into it —
// the exact counterpart of deny() — so the pairing survives the next resend; a dangling tool_use
// 400s at the API. Sibling results from the same turn merge into that ONE user turn (the API
// requires every tool_use in a turn to be answered in the single next user message). In the
// inline tool path we never hold the assistant tool_use turn, so there is nothing to pair and
// the result stays UI-only (returns the history unchanged).
function withToolResult(
  hist: AnyMsg[],
  toolUseId: string,
  summary: string,
  isError: boolean,
): AnyMsg[] {
  const holdsToolUse = (m: AnyMsg | undefined) =>
    m?.role === 'assistant' &&
    Array.isArray(m.content) &&
    m.content.some((b: unknown) => {
      const blk = b as { type?: string; id?: string }
      return blk.type === 'tool_use' && blk.id === toolUseId
    })
  const block = { type: 'tool_result', tool_use_id: toolUseId, content: summary, is_error: isError }
  const last = hist[hist.length - 1]
  if (holdsToolUse(last)) return [...hist, { role: 'user', content: [block] }]
  if (last?.role === 'user' && Array.isArray(last.content) && holdsToolUse(hist[hist.length - 2])) {
    return [
      ...hist.slice(0, -1),
      { role: 'user', content: [...(last.content as unknown[]), block] },
    ]
  }
  return hist
}

export function useAiChat() {
  const queryClient = useQueryClient()
  const [items, setItems] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Mutable conversation state shared across stream callbacks.
  const history = useRef<AnyMsg[]>([])
  const approved = useRef<string[]>([])
  const assistantId = useRef<string | null>(null)

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    assistantId.current = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch(FUNCTIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON_KEY,
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({ messages: history.current, approvedToolUseIds: approved.current }),
      })
      if (!res.ok || !res.body) {
        // Guardrail + input-cap rejections arrive PRE-STREAM as HTTP statuses (ai-chat): 503 =
        // monthly budget kill-switch, 429 = rate limit, 413 = message/history too large. None
        // are sent in-band.
        setError(
          res.status === 503
            ? 'AI is paused for this month (budget cap reached).'
            : res.status === 429
              ? 'Slow down a moment — rate limit reached.'
              : res.status === 413
                ? 'That message is too long — please shorten it.'
                : 'Chat failed.',
        )
        setBusy(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 2)
          if (line.startsWith('data: ')) handleEvent(JSON.parse(line.slice(6)))
        }
      }
    } catch {
      setError('Chat failed.')
    } finally {
      setBusy(false)
    }
  }, [])

  function handleEvent(ev: Record<string, unknown>) {
    switch (ev.type) {
      case 'text-delta': {
        const delta = ev.text as string
        if (!assistantId.current) {
          const id = nextId()
          assistantId.current = id
          setItems((xs) => [...xs, { id, role: 'assistant', text: delta }])
        } else {
          const id = assistantId.current
          setItems((xs) => xs.map((x) => (x.id === id ? { ...x, text: x.text + delta } : x)))
        }
        break
      }
      case 'tool-result':
        history.current = withToolResult(
          history.current,
          ev.tool_use_id as string,
          ev.summary as string,
          ev.ok === false,
        )
        setItems((xs) => [
          ...xs,
          { id: nextId(), role: 'tool', text: ev.summary as string, ok: ev.ok as boolean },
        ])
        // Live-refresh: a successful mutating tool tells us which data domains changed — invalidate
        // the matching queries so the grid/list/habits/Done update the instant the tool runs.
        if (ev.ok !== false && Array.isArray(ev.mutated)) {
          for (const domain of ev.mutated as string[]) {
            const key = DOMAIN_QUERY_KEYS[domain]
            if (key) void queryClient.invalidateQueries({ queryKey: key })
          }
        }
        break
      case 'tool-pending-confirmation':
        history.current = ev.messages as AnyMsg[] // includes the halting assistant turn
        setPending({ toolUseId: ev.tool_use_id as string, summary: ev.summary as string })
        break
      case 'message':
        history.current = [...history.current, { role: 'assistant', content: ev.content }]
        assistantId.current = null
        break
      case 'done':
        break
      case 'error':
        // The only in-band codes are 'tool-loop-cap' and 'chat_failed' — budget/rate-limit
        // rejections never reach the stream (they are the pre-stream 503/429 mapped in run()).
        setError('Chat failed.')
        break
    }
  }

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      approved.current = [] // a new user turn clears prior approvals
      history.current = [...history.current, { role: 'user', content: trimmed }]
      setItems((xs) => [...xs, { id: nextId(), role: 'user', text: trimmed }])
      void run()
    },
    [busy, run],
  )

  const confirm = useCallback(() => {
    if (!pending) return
    approved.current = [...approved.current, pending.toolUseId]
    setItems((xs) => [...xs, { id: nextId(), role: 'tool', text: 'Confirmed.', ok: true }])
    setPending(null)
    void run()
  }, [pending, run])

  const deny = useCallback(() => {
    if (!pending) return
    // Feed a declined tool_result back so the model continues without the action.
    history.current = [
      ...history.current,
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: pending.toolUseId,
            content: 'User declined this action.',
            is_error: true,
          },
        ],
      },
    ]
    setItems((xs) => [...xs, { id: nextId(), role: 'tool', text: 'Declined.', ok: false }])
    setPending(null)
    void run()
  }, [pending, run])

  return { items, busy, pending, error, send, confirm, deny }
}
