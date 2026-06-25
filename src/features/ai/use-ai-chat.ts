import { useCallback, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Streaming chat over the ai-chat Edge Function. functions.invoke() doesn't expose streams, so
// we fetch() directly with the user's access token and read the SSE body. The conversation is
// CLIENT-HELD: we keep the Anthropic message history in a ref and resend it each turn. Destructive
// tools pause for confirmation — confirm() re-sends with the approved id; deny() feeds a declined
// tool_result back so the model continues gracefully.

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

export function useAiChat() {
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
        setError(res.status === 429 ? 'Slow down a moment — rate limit reached.' : 'Chat failed.')
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
        setItems((xs) => [
          ...xs,
          { id: nextId(), role: 'tool', text: ev.summary as string, ok: ev.ok as boolean },
        ])
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
        setError(
          ev.code === 'budget-exhausted'
            ? 'AI is paused for this month (budget cap reached).'
            : ev.code === 'rate-limited'
              ? 'Slow down a moment — rate limit reached.'
              : 'Chat failed.',
        )
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
