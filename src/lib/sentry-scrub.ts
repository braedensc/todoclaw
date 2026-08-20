// sentry-scrub — the Sentry `beforeSend` PII scrubber (G1 roadmap item).
//
// Sentry is a third-party processor, so an event must leave the browser carrying only what
// debugging needs: error type + stack + release/environment/route shape. Everything
// user-generated is stripped before send:
//   - request bodies / cookies / headers (a Supabase write carries the full task row)
//   - the user object except `id` (email is PII)
//   - breadcrumb free-form payloads — console args and fetch bodies can embed task titles and
//     chat text; only the SHAPE survives (category, method, status, query-stripped URL)
//   - any JWT-shaped string anywhere in the event — Supabase access tokens ride in headers and
//     realtime URLs, and a leaked access token is a live session
//
// Pure function (no Sentry runtime import) so Vitest covers it without a DSN.

import type { Breadcrumb, ErrorEvent } from '@sentry/react'

// header.payload.signature, each base64url. Supabase JWTs (and the anon key) match; the 8-char
// floor keeps ordinary prose containing "eyJ" from tripping it.
const JWT_RE = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g

const scrubJwts = (s: string): string => s.replace(JWT_RE, '[jwt-redacted]')

// Query strings carry Supabase filters and apikey params; the path alone identifies the endpoint.
const stripQuery = (url: string): string => {
  const i = url.indexOf('?')
  return i === -1 ? url : url.slice(0, i)
}

function scrubBreadcrumb(b: Breadcrumb): Breadcrumb {
  const out: Breadcrumb = {
    timestamp: b.timestamp,
    type: b.type,
    category: b.category,
    level: b.level,
  }
  const d = b.data
  // http breadcrumbs keep the request shape — "the PATCH to /rest/v1/tasks 500'd" — never the body.
  if (d && (b.category === 'fetch' || b.category === 'xhr')) {
    out.data = {
      ...(typeof d.method === 'string' ? { method: d.method } : {}),
      ...(typeof d.url === 'string' ? { url: stripQuery(d.url) } : {}),
      ...(typeof d.status_code === 'number' ? { status_code: d.status_code } : {}),
    }
  }
  // navigation keeps query-stripped from/to (hash routes are structural, deep-link params aren't).
  if (d && b.category === 'navigation') {
    out.data = {
      ...(typeof d.from === 'string' ? { from: stripQuery(d.from) } : {}),
      ...(typeof d.to === 'string' ? { to: stripQuery(d.to) } : {}),
    }
  }
  // ui.* messages are CSS selectors (which control was tapped) — structural, kept. Console
  // breadcrumb messages are the logged args verbatim (can embed task/chat text) — dropped.
  if (b.message && b.category?.startsWith('ui.')) out.message = b.message
  return out
}

// Final safety net after the targeted removals: no JWT-shaped string survives anywhere in the
// event (exception messages, extra, contexts). Events are plain JSON data, so a walk is safe.
function deepScrubStrings<T>(v: T): T {
  if (typeof v === 'string') return scrubJwts(v) as T
  if (Array.isArray(v)) return v.map(deepScrubStrings) as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) out[k] = deepScrubStrings(val)
    return out as T
  }
  return v
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data
    delete event.request.cookies
    delete event.request.headers
    delete event.request.query_string
    if (event.request.url) event.request.url = stripQuery(event.request.url)
  }
  if (event.user) event.user = { id: event.user.id }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb)
  return deepScrubStrings(event)
}
