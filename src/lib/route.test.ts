import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { chatMessageId, hashToRoute, navigate, navigateToChat, useRoute } from './route'

// Reset the URL hash after each test so module/global state doesn't leak between cases.
afterEach(() => {
  window.location.hash = ''
})

describe('hashToRoute', () => {
  it('maps the known page hashes and treats everything else as home', () => {
    expect(hashToRoute('#/done')).toBe('done')
    expect(hashToRoute('#/reminders')).toBe('reminders')
    expect(hashToRoute('')).toBe('home')
    expect(hashToRoute('#/')).toBe('home')
    expect(hashToRoute('#/anything-else')).toBe('home')
  })

  it('maps bare and deep-linked chat hashes to the chat route (ADR-0031)', () => {
    expect(hashToRoute('#/chat')).toBe('chat')
    expect(hashToRoute('#/chat/abc-123')).toBe('chat')
  })
})

describe('chatMessageId', () => {
  it('extracts the message id from a deep link, decoding it', () => {
    expect(chatMessageId('#/chat/abc-123')).toBe('abc-123')
    expect(chatMessageId('#/chat/a%2Fb')).toBe('a/b')
  })

  it('is null for a bare chat hash or any non-chat hash', () => {
    expect(chatMessageId('#/chat')).toBeNull()
    expect(chatMessageId('#/chat/')).toBeNull()
    expect(chatMessageId('#/done')).toBeNull()
    expect(chatMessageId('')).toBeNull()
  })
})

describe('navigateToChat', () => {
  it('sets a #/chat/<id> hash (encoded), routing to chat', () => {
    navigateToChat('m1')
    expect(window.location.hash).toBe('#/chat/m1')
    expect(hashToRoute(window.location.hash)).toBe('chat')
    expect(chatMessageId(window.location.hash)).toBe('m1')
  })
})

describe('useRoute', () => {
  it('reads the initial hash', () => {
    window.location.hash = '#/done'
    const { result } = renderHook(() => useRoute())
    expect(result.current).toBe('done')
  })

  it('reacts to Back/Forward (a hashchange)', () => {
    window.location.hash = '#/done'
    const { result } = renderHook(() => useRoute())
    expect(result.current).toBe('done')

    // Simulate the browser popping back to home: the hash changes and hashchange fires.
    act(() => {
      window.location.hash = ''
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(result.current).toBe('home')
  })
})

describe('navigate', () => {
  it('sets the URL hash for a route, updating a subscribed hook', () => {
    const { result } = renderHook(() => useRoute())
    expect(result.current).toBe('home')

    act(() => {
      navigate('reminders')
      // jsdom does not always auto-fire hashchange on assignment; nudge it so the store re-reads.
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(window.location.hash).toBe('#/reminders')
    expect(result.current).toBe('reminders')
  })
})
