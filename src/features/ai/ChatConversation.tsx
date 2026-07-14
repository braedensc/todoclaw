import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ChatItem } from './use-ai-chat'
import type { ChatController } from './use-chat-controller'
import type { ChatSession } from '../../types/chat'
import { splitReply } from './reply-status'
import { ChatSessionList } from './ChatSessionList'
import { TodoClawPeek } from '../../components/TodoClawPeek'
import { SleepingPuppy } from '../../components/SleepingPuppy'
import { PawPrint } from '../../components/PawPrint'

// The full BabyClaw conversation UI (header + streamed history + confirm gate + input), factored
// out of ChatPanel so BOTH chat shells render the same thing:
//  - desktop: ChatRail — a slide-out RIGHT column that PUSHES the grid left (B2 decision)
//  - mobile (< 720px): ChatPanel — a bottom sheet overlay (no room to push)
// It fills its container (h-full flex-col); the shell owns positioning/animation/sizing. The
// conversation is OWNED by the shell (useChatController) and passed in, so the inline one-line
// reply and this view are the same conversation. The model call is server-side (owner key);
// tools are user-scoped (RLS) — see ADR-0017.
//
// "BabyClaw's study" redesign (2026-07-14): the drawer is now his room, not a grey column — a warm
// header band with the peeking pup (TodoClawPeek) over the top edge + a "collar tag" naming the
// session, paw-print avatars on his replies, tool actions rendered as stamped "paw receipts", quick
// suggestion chips over the composer, a paw send button, and a SleepingPuppy empty state. Every motif
// is the app's existing kit (TodoClawPeek / SleepingPuppy / PawPrint), reused, not invented.
//
// `showClose` (default true) draws the header ✕. Desktop (ChatRail) keeps it — the push-drawer has
// no swipe affordance. The mobile sheet (ChatPanel) passes `false`: it dismisses via a swipe-down on
// its grab handle / a scrim tap / Back, matching every other mobile sheet, so the ✕ is redundant.

// Quick-start chips over the composer — one tap sends the text as a normal turn (BabyClaw has the
// tools to plan, triage, and add). Hidden while a confirmation is pending or the budget is paused.
const SUGGESTIONS = ['Plan my day', "What's overdue?", 'Add a task'] as const

// The "collar tag" for the open conversation: proactive sessions (opened from the inbox) name their
// kind + carry a bell; a titled human chat shows its title. A brand-new chat gets none.
function sessionTag(s: ChatSession | null): { label: string; bell: boolean } | null {
  if (!s) return null
  if (s.origin === 'proactive') {
    const label =
      s.kind === 'plan'
        ? 'Morning plan'
        : s.kind === 'recap'
          ? 'Evening recap'
          : s.kind === 'reminder'
            ? 'Reminder'
            : 'From BabyClaw'
    return { label, bell: true }
  }
  const title = s.title?.trim()
  return title ? { label: title, bell: false } : null
}

export function ChatConversation({
  chat,
  onClose,
  showClose = true,
  readOnly = false,
  enableSessions = false,
}: {
  chat: ChatController
  onClose: () => void
  showClose?: boolean
  /**
   * Hide the composer entirely — for look-only renders (the onboarding DemoScene's canned
   * check-ins). A visible input would invite a reply the surface can't take.
   */
  readOnly?: boolean
  /**
   * Show the in-drawer session switcher (the "See all chats" button → the unified inbox + saved-chat
   * list, with a back button). ON for both real shells (desktop rail + mobile sheet) since the inbox
   * was retired and the drawer IS the inbox now. OFF only for the look-only demo. New-chat lives in
   * the list, never in this header.
   */
  enableSessions?: boolean
}) {
  const {
    items,
    busy,
    pending,
    error,
    send,
    confirm,
    deny,
    paused,
    sessionId,
    activeSession,
    openSession,
    newChat,
  } = chat
  const [text, setText] = useState('')
  const [view, setView] = useState<'conversation' | 'history'>('conversation')
  const showHistory = enableSessions && view === 'history'
  const listRef = useRef<HTMLUListElement>(null)
  const tag = sessionTag(activeSession)

  // Keep the latest message in view as things stream in.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items, pending])

  function submit(value: string) {
    const t = value.trim()
    if (!t) return
    send(t)
    setText('')
  }
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    submit(text)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      {/* Header band — a soft puppy-wash gradient with the peeking pup over its top-left edge. */}
      <div className="relative shrink-0 border-b border-border bg-gradient-to-b from-puppy/10 to-transparent px-4 pb-3 pt-3">
        {showHistory ? (
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-puppy/10 text-puppy">
                <PawPrint className="h-3.5 w-3.5" />
              </span>
              Your chats
            </h2>
            <button
              type="button"
              onClick={() => setView('conversation')}
              aria-label="Back to conversation"
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-card px-3 py-1 text-xs font-medium text-ink hover:border-puppy/50"
            >
              ← Back to chat
            </button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2 pl-[52px]">
            {/* The peeking pup hooked over the header's top-left — a picture of BabyClaw's namesake
                greeting you. `playful` gives him blinks, ear-flicks, a tongue blep (reduced-motion
                safe). Decorative (aria-hidden inside the component). */}
            <TodoClawPeek
              playful
              className="pointer-events-none absolute left-3 top-1 h-12 w-12 drop-shadow-sm"
            />
            <div className="min-w-0">
              <h2 className="font-serif text-lg font-semibold leading-tight text-ink">BabyClaw</h2>
              {/* The session name sits right under his name (desktop + mobile) — a "collar tag" for a
                  proactive message (Morning plan / …), or the chat's title. Falls back to his tagline
                  for a fresh, unnamed chat. */}
              {tag ? (
                <span className="mt-1 inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-border-strong bg-card px-2.5 py-0.5 text-[11px] text-muted">
                  {tag.bell ? (
                    <BellGlyph className="h-3 w-3 shrink-0 text-puppy" />
                  ) : (
                    <PawPrint className="h-3 w-3 shrink-0 text-puppy" />
                  )}
                  <span className="truncate font-medium text-ink">{tag.label}</span>
                </span>
              ) : (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_0_3px_rgba(91,138,114,0.16)]"
                  />
                  your planning pup
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 text-muted">
              {enableSessions && (
                <button
                  type="button"
                  onClick={() => setView('history')}
                  title="Your inbox + saved chats"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-card px-2.5 py-1 text-[11px] font-medium text-ink hover:border-puppy/50"
                >
                  <ListGlyph className="h-3 w-3 text-puppy" /> See all chats
                </button>
              )}
              {showClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close chat"
                  className="hover:text-ink"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showHistory ? (
        <ChatSessionList
          currentId={sessionId}
          onOpen={(id) => {
            openSession(id)
            setView('conversation')
          }}
          onNew={() => {
            newChat()
            setView('conversation')
          }}
        />
      ) : (
        <>
          <ul
            ref={listRef}
            className="relative flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-4 py-4"
          >
            {items.length === 0 && !paused && <EmptyState readOnly={readOnly} />}
            {paused && (
              <li className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-accent">
                AI is paused for this month — the budget cap was reached. The planner still works
                without it.
              </li>
            )}
            {items.map((it) => (
              <Bubble key={it.id} item={it} />
            ))}
            {busy && !pending && (
              <li className="flex items-center gap-2 pl-9 text-xs text-muted">
                <span className="inline-flex gap-1" aria-hidden>
                  <PawDot /> <PawDot d="0.16s" /> <PawDot d="0.32s" />
                </span>
                sniffing that out…
              </li>
            )}
          </ul>

          {pending && (
            <div className="border-t border-border bg-card px-4 py-3">
              {/* Same voice as the Task Manager widget's waiting strip — one consistent "he's stopped,
              it's your move" signal wherever the conversation surfaces. */}
              <p className="text-[11px] font-semibold uppercase tracking-wide text-puppy">
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
                  className="rounded-lg bg-puppy px-3 py-1.5 text-sm font-medium text-white"
                >
                  Yes, do it
                </button>
                <button
                  type="button"
                  onClick={deny}
                  className="rounded-lg border border-border-strong px-3 py-1.5 text-sm text-ink"
                >
                  Not now
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
            <div className="border-t border-border bg-panel p-3">
              {!pending && !paused && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      onClick={() => submit(s)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-card px-3 py-1 text-xs text-ink hover:border-puppy/50 disabled:opacity-50"
                    >
                      <PawPrint className="h-3 w-3 text-puppy" />
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <form onSubmit={handleSubmit} className="flex items-center gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  // While a confirmation is pending, a typed reply answers it (send routes yes/no to
                  // confirm/deny) — the buttons above stay as the one-click path.
                  placeholder={
                    pending
                      ? 'Yes or no — or say what to do instead…'
                      : 'Tell BabyClaw what you need…'
                  }
                  aria-label="Message"
                  disabled={paused}
                  enterKeyHint="send"
                  className="min-w-0 flex-1 rounded-xl border border-border-strong bg-card px-3 py-2.5 text-sm disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={busy || paused || !text.trim()}
                  aria-label="Send"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-white shadow-[0_2px_0_rgba(58,90,73,0.35)] disabled:opacity-50"
                >
                  <PawPrint className="h-5 w-5" />
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// The empty/idle state — BabyClaw curled up asleep (SleepingPuppy) with an invitation. The composer
// below carries the suggestion chips, so this stays a single warm illustration + one line.
function EmptyState({ readOnly }: { readOnly: boolean }) {
  return (
    <li className="flex flex-col items-center gap-3 px-6 pb-2 pt-8 text-center">
      <SleepingPuppy className="h-24 w-36 text-puppy/80" />
      <p className="font-serif text-base font-semibold text-ink">
        {readOnly ? 'Meet BabyClaw' : "BabyClaw's having a nap"}
      </p>
      <p className="max-w-[32ch] text-sm leading-relaxed text-muted">
        Tell him what's on your plate and he'll add, move, plan, or clear it — in plain English.
      </p>
    </li>
  )
}

function Bubble({ item }: { item: ChatItem }) {
  if (item.role === 'tool') {
    // A tool action comes back as a stamped "paw receipt" — green for done, terracotta for a
    // heads-up — instead of a grey system line. Indented to sit under BabyClaw's replies.
    const ok = item.ok !== false
    return (
      <li className="pl-9">
        <span
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${
            ok
              ? 'border-primary/30 bg-primary/10 text-[#39604c]'
              : 'border-accent/30 bg-accent/10 text-[#8a4a29]'
          }`}
        >
          <span aria-hidden className="text-[13px] leading-none">
            {ok ? '✓' : '✕'}
          </span>
          {item.text}
        </span>
      </li>
    )
  }
  const isUser = item.role === 'user'
  // BabyClaw's replies end with a machine-read [[status: …]] line for the add-widget one-liner —
  // hide it from the bubble (falling back to the status itself if the reply was ONLY that line).
  const { body, status } = isUser ? { body: item.text, status: null } : splitReply(item.text)
  if (isUser) {
    return (
      <li className="flex justify-end">
        <span className="inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-ink px-3 py-2 text-sm text-white">
          {body || '…'}
        </span>
      </li>
    )
  }
  return (
    <li className="flex items-end gap-2">
      {/* A small paw avatar marks BabyClaw's own replies — his slate-blue on a soft wash. */}
      <span
        aria-hidden
        className="grid h-7 w-7 shrink-0 place-items-center self-start rounded-full border border-puppy/30 bg-puppy/10 text-puppy"
      >
        <PawPrint className="h-3.5 w-3.5" />
      </span>
      <span className="inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md border border-border bg-card px-3 py-2 text-sm text-ink">
        {body || status || '…'}
      </span>
    </li>
  )
}

// One bouncing paw-pad of the "sniffing that out…" typing indicator.
function PawDot({ d }: { d?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full bg-puppy motion-safe:animate-[pawpad_1.05s_infinite]"
      style={d ? { animationDelay: d } : undefined}
    />
  )
}

// The "See all chats" glyph — a small stacked list, sized by the caller.
function ListGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  )
}

// The header/collar bell (matches NotificationBell's stroke glyph), sized to 1em by the caller.
function BellGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  )
}
