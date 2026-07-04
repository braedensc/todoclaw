import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ChatItem } from './use-ai-chat'
import type { ChatController } from './use-chat-controller'
import { AiPrivacyNote } from './AiPrivacyNote'

// Chat popup — the full BabyClaw conversation history (B8). Opened from the input widget's
// BabyClaw mode ("Open chat"); on desktop it's a right slide-over, on mobile a bottom sheet. It
// streams the assistant's reply token-by-token and pauses for confirmation before any destructive
// tool runs. The conversation is OWNED by the shell (useChatController) and passed in, so the
// inline one-line reply and this popup are the same conversation. The model call is server-side
// (owner key); tools are user-scoped (RLS) — see ADR-0017.
export function ChatPanel({ chat, onClose }: { chat: ChatController; onClose: () => void }) {
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
    <aside
      aria-label="Chat"
      // Mobile: a bottom sheet (rounded top, capped height) that covers the lower screen; z-50 so
      // it sits above everything. Desktop (wide:): the original right slide-over, capped max-w-sm.
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border border-border-strong bg-panel shadow-xl wide:inset-y-0 wide:left-auto wide:right-0 wide:max-h-none wide:max-w-sm wide:rounded-none wide:border-l"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-serif text-lg font-semibold text-ink">BabyClaw</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="text-muted hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="border-b border-border px-4 py-2">
        <AiPrivacyNote compact />
      </div>

      <ul ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-4">
        {items.length === 0 && !paused && (
          <li className="text-sm text-muted">
            Meet <span className="font-medium text-ink">BabyClaw</span> — your personal planning
            assistant. Tell him what you need in plain English and he’ll add, schedule, move,
            complete, or clear tasks and habits, or plan your day. Try: “add book dentist, due
            Friday, high importance.”
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
          <p className="text-sm text-ink">{pending.summary}?</p>
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

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message…"
          aria-label="Message"
          disabled={paused || !!pending}
          className="flex-1 rounded border border-border-strong bg-card px-3 py-2 text-sm disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || paused || !!pending || !text.trim()}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </aside>
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
  return (
    <li className={isUser ? 'text-right' : 'text-left'}>
      <span
        className={`inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
          isUser ? 'bg-ink text-white' : 'bg-card text-ink'
        }`}
      >
        {item.text}
      </span>
    </li>
  )
}
