import type { Page, Route } from '@playwright/test'

// Route mocks for the three AI Edge Function endpoints. The golden suite NEVER reaches a real
// function (zero Anthropic spend — the Stage 4.5 hard rule): specs install these per-page and
// assert via the returned recorder that every request was served from the mock, plus
// `detectEscapes` to prove nothing slipped past to the network.
//
// CORS: the app origin (localhost:5174) differs from the functions origin (127.0.0.1:54321),
// and the requests carry Authorization/apikey headers — so the browser may preflight. Every
// handler answers OPTIONS with permissive CORS and attaches the allow-origin header to real
// responses, which keeps the mocks valid whether or not the interception path enforces CORS.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  // supabase-js attaches x-client-info to functions.invoke — omit it here and a real preflight
  // would reject the request before the POST ever fires.
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export interface RouteRecorder {
  /** Number of POSTs served by this mock (OPTIONS preflights are not counted). */
  posts: () => number
  /** Parsed JSON request bodies of those POSTs, in order. */
  bodies: () => unknown[]
}

/** Encode events as the ai-chat SSE wire format: `data: {json}\n\n` per event. */
export function sse(...events: object[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
}

// Shared handler shape: answer preflights, record + fulfill POSTs. `payloads` is indexed by
// POST order and clamps to the last entry (a panel may refetch more times than the spec cares
// to enumerate).
function install(
  page: Page,
  pattern: string,
  contentType: string,
  payloads: string[],
): Promise<RouteRecorder> {
  const recorded: unknown[] = []
  return page
    .route(pattern, async (route: Route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS_HEADERS })
        return
      }
      recorded.push(route.request().postDataJSON())
      const body = payloads[Math.min(recorded.length - 1, payloads.length - 1)]
      await route.fulfill({ status: 200, contentType, headers: CORS_HEADERS, body })
    })
    .then(() => ({
      posts: () => recorded.length,
      bodies: () => [...recorded],
    }))
}

/** ai-status → healthy, not paused (panels read `paused` to gate themselves). */
export function mockAiStatus(page: Page): Promise<RouteRecorder> {
  const status = {
    paused: false,
    budgetRemainingMicros: 20_000_000,
    limits: { chat: { hour: 30, day: 100 }, plan_my_day: { hour: 10, day: 10 } },
    used: { chat: { hour: 0, day: 0 }, plan_my_day: { hour: 0, day: 0 } },
  }
  return install(page, '**/functions/v1/ai-status', 'application/json', [JSON.stringify(status)])
}

/** plan-my-day → `{ plan }` per POST, one plan per call in order (clamped to the last). */
export function mockPlanMyDay(page: Page, plans: object[]): Promise<RouteRecorder> {
  return install(
    page,
    '**/functions/v1/plan-my-day',
    'application/json',
    plans.map((plan) => JSON.stringify({ plan })),
  )
}

/** ai-chat → one SSE body (built with `sse(...)`) per POST in order (clamped to the last). */
export function mockAiChat(page: Page, sseBodies: string[]): Promise<RouteRecorder> {
  return install(page, '**/functions/v1/ai-chat', 'text/event-stream', sseBodies)
}

/**
 * Catch-all escape detector. Register FIRST (Playwright tries later-registered routes first,
 * so the specific mocks above win); anything reaching a functions endpoint WITHOUT a mock is
 * aborted and recorded. Specs end with `expect(escapes()).toEqual([])` — the zero-real-calls
 * proof.
 *
 * NOTE: specs install mocks AFTER the fixture's initial `page.goto('/')`. That is safe today
 * because nothing outside the AI panels calls /functions/v1 and the panels mount only on a
 * button click — but if an AI surface ever fires on app load (e.g. a shell-level paused
 * banner), move mock installation into the fixture so no request pre-dates the routes.
 */
export async function detectEscapes(page: Page): Promise<() => string[]> {
  const escaped: string[] = []
  await page.route('**/functions/v1/**', async (route: Route) => {
    escaped.push(`${route.request().method()} ${route.request().url()}`)
    await route.abort()
  })
  return () => [...escaped]
}
