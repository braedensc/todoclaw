import { useSyncExternalStore } from 'react'

// Client-side routing for the SPA (ADR-0027). Todoclaw is a single-screen shell; "Done" and
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

export type AppRoute = 'home' | 'done' | 'reminders'

const ROUTE_TO_HASH: Record<AppRoute, string> = {
  home: '#/',
  done: '#/done',
  reminders: '#/reminders',
}

/** Parse a `location.hash` string into a route. Anything unrecognized is 'home'. Exported for tests. */
export function hashToRoute(hash: string): AppRoute {
  switch (hash) {
    case ROUTE_TO_HASH.done:
      return 'done'
    case ROUTE_TO_HASH.reminders:
      return 'reminders'
    default:
      return 'home'
  }
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

/**
 * The page Back affordance (the ✕ / back control on Done & Reminders). Pops to the previous in-app
 * view when there is one; on a cold deep link with no in-app history, falls back to 'home' so Back
 * never navigates away from the app entirely.
 */
export function goBack(): void {
  if (hasNavigatedWithinApp) window.history.back()
  else navigate('home')
}
