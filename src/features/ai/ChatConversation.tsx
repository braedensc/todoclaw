import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ChatItem } from './use-ai-chat'
import type { ChatController } from './use-chat-controller'
import { splitReply } from './reply-status'
import { TodoClawIcon } from '../../components/TodoClawIcon'

// The full BabyClaw conversation UI (header + streamed history + confirm gate + input), factored
// out of ChatPanel so BOTH chat shells render the same thing:
//  - desktop: ChatRail — a slide-out RIGHT column that PUSHES the grid left (B2 decision)
//  - mobile (< 720px): ChatPanel — a bottom sheet overlay (no room to push)
// It fills its container (h-full flex-col); the shell owns positioning/animation/sizing. The
// conversation is OWNED by the shell (useChatController) and passed in, so the inline one-line
// reply and this view are the same conversation. The model call is server-side (owner key);
// tools are user-scoped (RLS) — see ADR-0017.
//
// `showClose` (default true) draws the header ✕. Desktop (ChatRail) keeps it — the push-drawer has
// no swipe affordance. The mobile sheet (ChatPanel) passes `false`: it dismisses via a swipe-down on
// its grab handle / a scrim tap / Back, matching every other mobile sheet, so the ✕ is redundant.
export function ChatConversation({
  chat,
  onClose,
  showClose = true,
  readOnly = false,
}: {
  chat: ChatController
  onClose: () => void
  showClose?: boolean
  /**
   * Hide the composer entirely — for look-only renders (the onboarding DemoScene's canned
   * check-ins). A visible input would invite a reply the surface can't take.
   */
  readOnly?: boolean
}) {
  const { items, busy, pending, error, send, confirm, deny, paused } = chat
  const [text, setText] = useState('')
  const listRef = useRef<HTMLUListElement>(null)

  // Keep the latest message in view as things stream in.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items, pending])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    send(text)
    setText('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        {/* The original jumping-up portrait fronts the chat — it's a picture of BabyClaw's own
            namesake, so his conversation is where it lives now (the app wordmark carries the
            peeking-pup mark, TodoClawPeek). His 🐾 stays the reply/status glyph everywhere. */}
        <h2 className="flex items-center gap-1.5 font-serif text-lg font-semibold text-ink">
          <TodoClawIcon className="h-6 w-6" />
          BabyClaw
        </h2>
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="text-muted hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>

      <ul ref={listRef} className="flex-1 space-y-2 overflow-y-auto overscroll-contain p-4">
        {items.length === 0 && !paused && (
          <li className="text-sm text-muted">
            Meet <span className="font-medium text-ink">BabyClaw</span> <span aria-hidden>🐾</span>{' '}
            — your personal planning assistant. Tell him what you need in plain English and he’ll
            add, schedule, move, complete, or clear tasks and habits, or plan your day. Try: “add
            book dentist, due Friday, high importance.”
          </li>
        )}
        {paused && (
          <li className="text-sm text-accent">
            AI is paused for this month — the budget cap was reached. The planner still works
            without it.
          </li>
        )}
        {items.map((it) => (
          <Bubble key={it.id} item={it} />
        ))}
        {busy && !pending && <li className="text-xs text-muted-light">…</li>}
      </ul>

      {pending && (
        <div className="border-t border-border bg-card px-4 py-3">
          {/* Same voice as the Task Manager widget's waiting strip — one consistent "he's stopped,
              it's your move" signal wherever the conversation surfaces. */}
          <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
            <span aria-hidden className="mr-1">
              🐾
            </span>
            BabyClaw is waiting on your reply
          </p>
          <p className="mt-1 text-sm text-ink">{pending.summary}?</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={confirm}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={deny}
              className="rounded border border-border-strong px-3 py-1.5 text-sm text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="border-t border-border px-4 py-2 text-sm text-accent" role="alert">
          {error}
        </p>
      )}

      {!readOnly && (
        <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            // While a confirmation is pending, a typed reply answers it (send routes yes/no to
            // confirm/deny) — the buttons above stay as the one-click path.
            placeholder={pending ? 'Yes or no — or say what to do instead…' : 'Message…'}
            aria-label="Message"
            disabled={paused}
            enterKeyHint="send"
            className="min-w-0 flex-1 rounded border border-border-strong bg-card px-3 py-2 text-sm disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || paused || !text.trim()}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </form>
      )}
    </div>
  )
}

function Bubble({ item }: { item: ChatItem }) {
  if (item.role === 'tool') {
    return (
      <li className={`text-xs ${item.ok === false ? 'text-accent' : 'text-muted-light'}`}>
        {item.ok === false ? '✕' : '✓'} {item.text}
      </li>
    )
  }
  const isUser = item.role === 'user'
  // BabyClaw's replies end with a machine-read [[status: …]] line for the add-widget one-liner —
  // hide it from the bubble (falling back to the status itself if the reply was ONLY that line).
  const { body, status } = isUser ? { body: item.text, status: null } : splitReply(item.text)
  return (
    <li className={isUser ? 'text-right' : 'text-left'}>
      {/* A small 🐾 marks BabyClaw's own replies (assistant only — never the user's). Decorative. */}
      {!isUser && (
        <span aria-hidden className="mr-1 select-none text-xs">
          🐾
        </span>
      )}
      <span
        className={`inline-block max-w-full whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
          isUser ? 'bg-ink text-white' : 'bg-card text-ink'
        }`}
      >
        {body || status || '…'}
      </span>
    </li>
  )
}
