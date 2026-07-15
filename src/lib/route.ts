import { useSyncExternalStore } from 'react'

// Client-side routing for the SPA (ADR-0027). TodoClaw is a single-screen shell; "Done" and
// "Daily reminders" are the two surfaces that graduated from modal overlays to full pages, so the
// route space is tiny — everything else is 'home'.
//
// Hash-based (`location.hash`) rather than History-API paths on purpose:
//   - No Vercel config. `vercel.json` has no SPA rewrite, so a clean path like `/done` would 404 on
//     a hard refresh or a shared deep link. `/#/done` always serves index.html — the hash is never
//     sent to the server.
//   - The browser Back button works for free: assigning `location.hash` pushes a history entry, and
//     Back/Forward fire `hashchange`, which we subscribe to.
// Trade-off: hash URLs are a little less pretty, and this is ~40 lines we own instead of a routing
// library — a deliberate fit for a 2–3 route app (see the ADR for the full comparison).

export type AppRoute = 'home' | 'done' | 'reminders' | 'chat' | 'admin'

const ROUTE_TO_HASH: Record<AppRoute, string> = {
  home: '#/',
  done: '#/done',
  reminders: '#/reminders',
  chat: '#/chat',
  admin: '#/admin',
}

const CHAT_PREFIX = '#/chat/'

/** Parse a `location.hash` string into a route. Anything unrecognized is 'home'. Exported for tests. */
export function hashToRoute(hash: string): AppRoute {
  if (hash === ROUTE_TO_HASH.done) return 'done'
  if (hash === ROUTE_TO_HASH.reminders) return 'reminders'
  if (hash === ROUTE_TO_HASH.admin) return 'admin'
  // `#/chat` (bare) or `#/chat/<messageId>` (deep link from a notification, ADR-0031).
  if (hash === ROUTE_TO_HASH.chat || hash.startsWith(CHAT_PREFIX)) return 'chat'
  return 'home'
}

/**
 * The message id in a `#/chat/<id>` deep link, or null for a bare `#/chat` (or any non-chat hash).
 * App uses it to seed the chat with that message + mark it read. Exported for tests.
 */
export function chatMessageId(hash: string = window.location.hash): string | null {
  if (!hash.startsWith(CHAT_PREFIX)) return null
  return decodeURIComponent(hash.slice(CHAT_PREFIX.length)) || null
}

function currentRoute(): AppRoute {
  return typeof window === 'undefined' ? 'home' : hashToRoute(window.location.hash)
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/**
 * The active route, derived from the URL hash. `useSyncExternalStore` keeps every subscriber in
 * lockstep with `location.hash` and re-renders on Back/Forward. The snapshot is a plain string so
 * it's referentially stable (compared with `Object.is`) — no memo needed.
 */
export function useRoute(): AppRoute {
  return useSyncExternalStore(subscribe, currentRoute, () => 'home')
}

/**
 * The message id of the current `#/chat/<id>` deep link (or null), as a reactive value. Unlike
 * `useRoute` — which collapses every `#/chat/*` to the single string `'chat'` — this tracks the id
 * itself, so a subscriber re-runs when the hash moves from one message to another WITHOUT leaving the
 * chat route (opening message B while message A's chat is still up). App keys its seed/open effect on
 * this so message→message never silently drops the second one.
 */
export function useChatMessageId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => chatMessageId(),
    () => null,
  )
}

// Whether we've navigated within the app this session. Guards `goBack` against walking off the app
// on a cold deep link (a fresh tab opened straight to `/#/done` has no in-app history to pop to).
let hasNavigatedWithinApp = false

/**
 * Navigate to a route by setting the URL hash — this pushes a history entry, so the browser Back
 * button returns to the prior view. Assigning the same hash is a no-op (no duplicate entry).
 */
export function navigate(route: AppRoute): void {
  hasNavigatedWithinApp = true
  const hash = ROUTE_TO_HASH[route]
  if (window.location.hash !== hash) window.location.hash = hash
}

/** Open the chat deep-linked to a message (`#/chat/<id>`), which seeds it. Bare `#/chat` if no id. */
export function navigateToChat(messageId?: string): void {
  hasNavigatedWithinApp = true
  const hash = messageId ? `${CHAT_PREFIX}${encodeURIComponent(messageId)}` : ROUTE_TO_HASH.chat
  if (window.location.hash !== hash) window.location.hash = hash
}

/**
 * The page Back affordance (the ✕ / back control on Done & Reminders). Pops to the previous in-app
 * view when there is one; on a cold deep link with no in-app history, falls back to 'home' so Back
 * never navigates away from the app entirely.
 */
export function goBack(): void {
  if (hasNavigatedWithinApp) window.history.back()
  else navigate('home')
}
