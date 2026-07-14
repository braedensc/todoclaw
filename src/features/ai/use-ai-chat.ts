import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useChatSessions, CHAT_SESSIONS_KEY } from './use-chat-sessions'
import { useChatMessages, rowsToChatItems } from './use-chat-messages'

// A mutating tool reports which data DOMAINS it changed; each maps to the TanStack Query key that
// owns that data, so acting in chat refreshes the grid / list / habits / Done tab INSTANTLY (no
// reload, no realtime round-trip). daily_state queries are keyed ['daily_state', date]; the bare
// ['daily_state'] prefix invalidates them all. Unknown domains are ignored.
const DOMAIN_QUERY_KEYS: Record<string, readonly unknown[]> = {
  tasks: ['tasks'],
  habits: ['habits'],
  daily_state: ['daily_state'],
  history: ['history'],
  // BabyClaw set_reminder/clear_reminder → refresh the reminder pickers (useTaskReminders).
  reminders: ['task_reminders'],
  // BabyClaw save/update/delete_memory → refresh the Settings → AI memory list (use-memories).
  memories: ['assistant_memories'],
  // The chat history list (persistent-chats ADR).
  chats: CHAT_SESSIONS_KEY,
}

// Streaming chat over the ai-chat Edge Function. The transcript is now SERVER-AUTHORITATIVE and
// durable (persistent-chats ADR): the client no longer holds or resends history. Each turn is a
// single new `message` (optionally with a deep-link `seed`) OR a confirm/deny `action`, always
// scoped to a `session_id` (null = create a new session; the server returns the new id on a `session`
// event). The rendered conversation = the persisted base of the opened session (hydrated once, frozen
// for the visit) + this visit's live-streamed turns (`liveItems`). liveItems is cleared on every
// session switch so a re-open never double-renders. On reload the DB is the truth; a failed turn
// simply isn't persisted. Destructive tools still pause for confirmation — confirm()/deny() send an
// `action`; the server validates it against its own recorded `pending` and answers every tool_use in
// the halted turn, so a resume can never leave a dangling tool_use.

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const DAY_MS = 24 * 60 * 60 * 1000

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

// A typed reply that counts as "yes" while a confirmation is pending. Anything else declines —
// with the user's words passed through, so "actually make it due Friday" both cancels the action
// and tells the model what to do instead.
const YES_RE =
  /^(y|yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|do it|go ahead|yes please|sure thing|please do)[\s.!]*$/i
// A bare "no" adds no words — anything richer rides along as the model's next instruction.
const NO_RE = /^(n|no|nope|nah|cancel|stop|don't)[\s.!]*$/i

let counter = 0
const nextId = () => `c${counter++}`

interface SessionPending {
  awaiting: { tool_use_id: string; name: string; summary: string }
}

type OutgoingBody =
  | { session_id: string | null; message: string; seed?: string }
  | {
      session_id: string
      action:
        | { type: 'confirm'; tool_use_id: string }
        | { type: 'deny'; tool_use_id: string; note?: string }
    }

export function useAiChat() {
  const queryClient = useQueryClient()
  const sessions = useChatSessions()

  // sessionId = the active conversation to send into (null = a not-yet-created new chat). hydrateId =
  // the session whose persisted history forms the frozen base; null for a fresh chat OR a session we
  // just created this visit (liveItems is authoritative there, so we must NOT refetch it as base).
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [hydrateId, setHydrateId] = useState<string | null>(null)
  const [liveItems, setLiveItems] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [error, setError] = useState<string | null>(null)

  const persisted = useChatMessages(hydrateId)
  const baseItems = useMemo(
    () => (persisted.data ? rowsToChatItems(persisted.data) : []),
    [persisted.data],
  )
  const items = useMemo(() => [...baseItems, ...liveItems], [baseItems, liveItems])

  const assistantId = useRef<string | null>(null)
  const seedRef = useRef<string | null>(null)
  // The active session id, mirrored into a ref so stream callbacks (which close over the memoized
  // run) always see the latest id after a `session` event adopts a freshly-created session.
  const sessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  // Resume-on-open: once the session list loads, reopen the most-recent conversation if it's < 24h
  // old, else stay on a fresh chat. Adjusted DURING render (guarded to run once) rather than in an
  // effect — React's sanctioned "derive state from freshly-arrived data" pattern; it commits before
  // paint (no extra frame, no flash of an empty chat) and keeps setState out of an effect.
  const resumedRef = useRef(false)
  if (!resumedRef.current && sessions.data) {
    resumedRef.current = true
    const recent = sessions.data[0]
    if (recent && Date.now() - Date.parse(recent.updated_at) < DAY_MS) {
      setSessionId(recent.id)
      setHydrateId(recent.id)
      if (recent.pending) {
        setPending({
          toolUseId: recent.pending.awaiting.tool_use_id,
          summary: recent.pending.awaiting.summary,
        })
      }
    }
  }

  const run = useCallback(
    async (body: OutgoingBody) => {
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
          body: JSON.stringify(body),
        })
        if (!res.ok || !res.body) {
          // Guardrail + input-cap rejections arrive PRE-STREAM as HTTP statuses: 503 = monthly budget
          // kill-switch, 429 = rate limit, 413 = message too large. The turn wasn't persisted.
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
    },
    // handleEvent only touches stable setters + queryClient (stable) + refs — no reactive deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  function handleEvent(ev: Record<string, unknown>) {
    switch (ev.type) {
      case 'session':
        // Adopt the session id (a brand-new chat learns its id here). Do NOT hydrate it as base —
        // liveItems already holds this visit's turns; refetching would double-render them.
        setSessionId(ev.session_id as string)
        break
      case 'text-delta': {
        const delta = ev.text as string
        if (!assistantId.current) {
          const id = nextId()
          assistantId.current = id
          setLiveItems((xs) => [...xs, { id, role: 'assistant', text: delta }])
        } else {
          const id = assistantId.current
          setLiveItems((xs) => xs.map((x) => (x.id === id ? { ...x, text: x.text + delta } : x)))
        }
        break
      }
      case 'tool-result': {
        // What the USER sees is `display`: undefined → reuse the summary (already a plain sentence);
        // null → an internal lookup we don't surface (no bubble). Never render raw ids / JSON.
        const display =
          ev.display === undefined ? (ev.summary as string) : (ev.display as string | null)
        if (display !== null) {
          setLiveItems((xs) => [
            ...xs,
            { id: nextId(), role: 'tool', text: display, ok: ev.ok as boolean },
          ])
        }
        // Live-refresh: a successful mutating tool tells us which data domains changed — invalidate
        // the matching queries so the grid/list/habits/Done update the instant the tool runs.
        if (ev.ok !== false && Array.isArray(ev.mutated)) {
          for (const domain of ev.mutated as string[]) {
            const key = DOMAIN_QUERY_KEYS[domain]
            if (key) void queryClient.invalidateQueries({ queryKey: key })
          }
        }
        break
      }
      case 'tool-pending-confirmation':
        setPending({ toolUseId: ev.tool_use_id as string, summary: ev.summary as string })
        break
      case 'message':
        // The assistant turn committed (persisted server-side). The live bubble already holds the
        // streamed text; nothing to adopt (no client history).
        assistantId.current = null
        break
      case 'done':
        // The session's updated_at (and a brand-new session) changed — refresh the history list.
        void queryClient.invalidateQueries({ queryKey: CHAT_SESSIONS_KEY })
        break
      case 'error': {
        const code = ev.code as string
        if (code === 'stale_confirmation') setPending(null)
        setError(typeof ev.message === 'string' ? (ev.message as string) : 'Chat failed.')
        break
      }
    }
  }

  // Seed the chat from a message it was opened for (a plan/recap notification). Idempotent per
  // message: shows the message as an assistant intro bubble; the actual context is folded into the
  // next user turn (see send). Ignores a repeat of the same seed (re-render / same deep link).
  const seed = useCallback((intro: string) => {
    const t = intro.trim()
    if (!t || seedRef.current === t) return
    seedRef.current = t
    setLiveItems((xs) => [...xs, { id: nextId(), role: 'assistant', text: t }])
  }, [])

  // Resolve the pending confirmation — shared by the drawer's Confirm/Cancel buttons and a typed
  // yes/no answer (`note` is the user's typed words, shown as their bubble). Approve sends a confirm
  // action (the server executes the tool); anything else sends a deny — with the words attached (when
  // richer than a bare "no") so the model can act on "no, make it due Friday instead".
  const resolvePending = useCallback(
    (approve: boolean, note?: string) => {
      const p = pending
      const sid = sessionIdRef.current
      if (!p || !sid) return
      if (note) setLiveItems((xs) => [...xs, { id: nextId(), role: 'user', text: note }])
      if (approve) {
        setLiveItems((xs) => [...xs, { id: nextId(), role: 'tool', text: 'Confirmed.', ok: true }])
        void run({ session_id: sid, action: { type: 'confirm', tool_use_id: p.toolUseId } })
      } else {
        setLiveItems((xs) => [...xs, { id: nextId(), role: 'tool', text: 'Declined.', ok: false }])
        const declineNote = note && !NO_RE.test(note.trim()) ? note : undefined
        void run({
          session_id: sid,
          action: {
            type: 'deny',
            tool_use_id: p.toolUseId,
            ...(declineNote ? { note: declineNote } : {}),
          },
        })
      }
      setPending(null)
    },
    [pending, run],
  )

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      // While a confirmation is pending, a typed reply IS the answer: yes-like confirms, anything
      // else declines (passing the words through).
      if (pending) {
        resolvePending(YES_RE.test(trimmed), trimmed)
        return
      }
      const seedText = seedRef.current ?? undefined
      seedRef.current = null
      setLiveItems((xs) => [...xs, { id: nextId(), role: 'user', text: trimmed }])
      void run({ session_id: sessionId, message: trimmed, ...(seedText ? { seed: seedText } : {}) })
    },
    [busy, pending, sessionId, resolvePending, run],
  )

  const confirm = useCallback(() => resolvePending(true), [resolvePending])
  const deny = useCallback(() => resolvePending(false), [resolvePending])

  // Switch to a saved conversation (history UI): hydrate its persisted base, clear this visit's live
  // turns, and surface any mid-flight confirmation from the row.
  const openSession = useCallback(
    (id: string) => {
      setSessionId(id)
      setHydrateId(id)
      setLiveItems([])
      setError(null)
      assistantId.current = null
      seedRef.current = null
      const s = sessions.data?.find((x) => x.id === id)
      const p = s?.pending as SessionPending | null | undefined
      setPending(p ? { toolUseId: p.awaiting.tool_use_id, summary: p.awaiting.summary } : null)
    },
    [sessions.data],
  )

  // Start a fresh conversation (created on the first send).
  const newChat = useCallback(() => {
    setSessionId(null)
    setHydrateId(null)
    setLiveItems([])
    setPending(null)
    setError(null)
    assistantId.current = null
    seedRef.current = null
  }, [])

  return {
    items,
    liveItems,
    busy,
    pending,
    error,
    send,
    confirm,
    deny,
    seed,
    sessionId,
    openSession,
    newChat,
  }
}
