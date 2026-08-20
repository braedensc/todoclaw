// Tests for scrubSentryEvent — what a Sentry event may still carry after beforeSend.
// The fixture JWT is fabricated (structure only), never a real token.
import { describe, it, expect } from 'vitest'
import type { ErrorEvent } from '@sentry/react'
import { scrubSentryEvent } from './sentry-scrub'

const FAKE_JWT = `eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(30)}.${'c'.repeat(40)}`

const baseEvent = (): ErrorEvent =>
  ({
    type: undefined,
    event_id: 'abc123',
    release: 'todoclaw@deadbeef',
    environment: 'production',
  }) as ErrorEvent

describe('scrubSentryEvent', () => {
  it('drops the request body, cookies, headers and query string; keeps the path', () => {
    const event = baseEvent()
    event.request = {
      url: 'https://example.supabase.co/rest/v1/tasks?select=*&user_id=eq.123',
      method: 'PATCH',
      data: { text: 'secret task title' },
      cookies: { session: 'abc' },
      headers: { Authorization: `Bearer ${FAKE_JWT}` },
      query_string: 'select=*',
    }
    const out = scrubSentryEvent(event)
    expect(out.request).toEqual({
      url: 'https://example.supabase.co/rest/v1/tasks',
      method: 'PATCH',
    })
  })

  it('reduces the user to id only (email never leaves)', () => {
    const event = baseEvent()
    event.user = { id: 'user-1', email: 'braeden@example.com', username: 'braeden' }
    const out = scrubSentryEvent(event)
    expect(out.user).toEqual({ id: 'user-1' })
  })

  it('drops console breadcrumb messages (logged args can embed task/chat text)', () => {
    const event = baseEvent()
    event.breadcrumbs = [
      {
        category: 'console',
        level: 'error',
        message: 'failed for task "buy gift"',
        data: { arguments: ['x'] },
      },
    ]
    const out = scrubSentryEvent(event).breadcrumbs![0]!
    expect(out.message).toBeUndefined()
    expect(out.data).toBeUndefined()
    expect(out.category).toBe('console')
  })

  it('keeps only method/url(no query)/status on fetch breadcrumbs', () => {
    const event = baseEvent()
    event.breadcrumbs = [
      {
        category: 'fetch',
        type: 'http',
        data: {
          method: 'POST',
          url: `https://example.supabase.co/functions/v1/ai-chat?apikey=${FAKE_JWT}`,
          status_code: 500,
          request_body_size: 999,
        },
      },
    ]
    const out = scrubSentryEvent(event).breadcrumbs![0]!
    expect(out.data).toEqual({
      method: 'POST',
      url: 'https://example.supabase.co/functions/v1/ai-chat',
      status_code: 500,
    })
  })

  it('keeps ui.* selector messages and query-stripped navigation from/to', () => {
    const event = baseEvent()
    event.breadcrumbs = [
      { category: 'ui.click', message: 'button.add-task > svg' },
      { category: 'navigation', data: { from: '/#/list', to: '/#/chat?session=abc' } },
    ]
    const crumbs = scrubSentryEvent(event).breadcrumbs!
    expect(crumbs[0]!.message).toBe('button.add-task > svg')
    expect(crumbs[1]!.data).toEqual({ from: '/#/list', to: '/#/chat' })
  })

  it('redacts JWT-shaped strings anywhere in the event', () => {
    const event = baseEvent()
    event.exception = {
      values: [{ type: 'Error', value: `fetch failed with token ${FAKE_JWT} attached` }],
    }
    event.extra = { note: FAKE_JWT }
    const out = scrubSentryEvent(event)
    expect(JSON.stringify(out)).not.toContain(FAKE_JWT)
    expect(out.exception!.values![0]!.value).toBe('fetch failed with token [jwt-redacted] attached')
  })

  it('leaves debugging essentials intact', () => {
    const out = scrubSentryEvent(baseEvent())
    expect(out.release).toBe('todoclaw@deadbeef')
    expect(out.environment).toBe('production')
    expect(out.event_id).toBe('abc123')
  })
})
