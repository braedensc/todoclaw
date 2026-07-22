import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createUpdateChecker,
  parseBuildSha,
  registerReloadBlocker,
  type UpdateCheckerDeps,
} from './app-update'

// The installed-PWA auto-update checker. Everything is injected (DI factory) — no module
// mocks, no timers: time is a controllable counter and fetch a stub returning dist-shaped HTML.

const SHA_OLD = 'a7c80db1585ba1f871612c42490166a9a5c48cbe'
const SHA_NEW = 'b1234567890abcdef1234567890abcdef1234567'

function distHtml(sha: string): string {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="build-sha" content="${sha}"><script type="module" src="/assets/index-epzIgQn0.js"></script></head><body><div id="root"></div></body></html>`
}

function htmlResponse(body: string, init?: { ok?: boolean; contentType?: string }): Response {
  return {
    ok: init?.ok ?? true,
    headers: {
      get: (k: string) =>
        k === 'content-type' ? (init?.contentType ?? 'text/html; charset=utf-8') : null,
    },
    text: () => Promise.resolve(body),
  } as unknown as Response
}

interface Harness {
  deps: UpdateCheckerDeps
  check: () => Promise<void>
  reload: ReturnType<typeof vi.fn>
  fetchFn: ReturnType<typeof vi.fn>
  store: Map<string, string>
  advance: (ms: number) => void
}

function makeHarness(overrides?: Partial<UpdateCheckerDeps> & { servedSha?: string }): Harness {
  let clock = 1_000_000
  let pageAge = 120_000 // past the 60s cold-launch grace by default
  const store = new Map<string, string>()
  const reload = vi.fn()
  const fetchFn = vi.fn(() =>
    Promise.resolve(htmlResponse(distHtml(overrides?.servedSha ?? SHA_NEW))),
  )
  const deps: UpdateCheckerDeps = {
    currentSha: SHA_OLD,
    fetchFn: fetchFn as unknown as typeof fetch,
    reload,
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    },
    doc: document,
    now: () => clock,
    pageAgeMs: () => pageAge,
    ...overrides,
  }
  const checker = createUpdateChecker(deps)
  return {
    deps,
    check: checker.check,
    reload,
    fetchFn,
    store,
    advance: (ms) => {
      clock += ms
      pageAge += ms
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('parseBuildSha', () => {
  it('extracts the sha from dist-shaped HTML', () => {
    expect(parseBuildSha(distHtml(SHA_OLD))).toBe(SHA_OLD)
  })
  it('rejects a missing meta, an empty local marker, and garbage content', () => {
    expect(parseBuildSha('<!doctype html><html><head></head><body></body></html>')).toBeNull()
    expect(parseBuildSha(distHtml(''))).toBeNull()
    expect(parseBuildSha(distHtml('not-a-sha!'))).toBeNull()
  })
  it('rejects captive-portal style pages', () => {
    expect(parseBuildSha('<html><body><h1>Sign in to Airport WiFi</h1></body></html>')).toBeNull()
  })
})

describe('createUpdateChecker', () => {
  it('does nothing when currentSha is empty (dev / CI / local builds)', async () => {
    const h = makeHarness({ currentSha: '' })
    await h.check()
    expect(h.fetchFn).not.toHaveBeenCalled()
  })

  it('does nothing during the cold-launch grace period', async () => {
    const h = makeHarness({ pageAgeMs: () => 10_000 })
    await h.check()
    expect(h.fetchFn).not.toHaveBeenCalled()
  })

  it('no-ops when the served sha matches the running build', async () => {
    const h = makeHarness({ servedSha: SHA_OLD })
    await h.check()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    expect(h.reload).not.toHaveBeenCalled()
  })

  it('reloads exactly once on a mismatch, writing the loop guard BEFORE reloading', async () => {
    const h = makeHarness()
    h.reload.mockImplementation(() => {
      expect(h.store.get('todoclaw:update-reload')).toContain(SHA_NEW)
    })
    await h.check()
    expect(h.reload).toHaveBeenCalledTimes(1)
    expect(h.deps.storage).not.toBeNull()
  })

  it('reports the transition via onReload', async () => {
    const onReload = vi.fn()
    const h = makeHarness({ onReload })
    await h.check()
    expect(onReload).toHaveBeenCalledWith(SHA_OLD, SHA_NEW)
  })

  it('suppresses repeat reloads for the same target sha within the guard TTL, allows after', async () => {
    const h = makeHarness()
    await h.check()
    expect(h.reload).toHaveBeenCalledTimes(1)
    h.advance(5 * 60_000) // still inside the 30-min guard — a stale CDN edge scenario
    await h.check()
    expect(h.reload).toHaveBeenCalledTimes(1)
    h.advance(31 * 60_000) // guard expired
    await h.check()
    expect(h.reload).toHaveBeenCalledTimes(2)
  })

  it('throttles bursts: pageshow+focus+visibilitychange within 60s cost one fetch', async () => {
    const h = makeHarness({ servedSha: SHA_OLD })
    await h.check()
    await h.check()
    await h.check()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    h.advance(61_000)
    await h.check()
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
  })

  it('swallows fetch rejections, non-200s, and wrong content types', async () => {
    const failing = makeHarness()
    failing.fetchFn.mockImplementation(() => Promise.reject(new Error('offline')))
    await expect(failing.check()).resolves.toBeUndefined()
    expect(failing.reload).not.toHaveBeenCalled()

    const non200 = makeHarness()
    non200.fetchFn.mockImplementation(() =>
      Promise.resolve(htmlResponse(distHtml(SHA_NEW), { ok: false })),
    )
    await non200.check()
    expect(non200.reload).not.toHaveBeenCalled()

    const wrongType = makeHarness()
    wrongType.fetchFn.mockImplementation(() =>
      Promise.resolve(htmlResponse(distHtml(SHA_NEW), { contentType: 'application/json' })),
    )
    await wrongType.check()
    expect(wrongType.reload).not.toHaveBeenCalled()
  })

  it('skips the check entirely while a text field is focused, without burning the throttle', async () => {
    const h = makeHarness()
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    input.focus()
    await h.check() // vetoed at trigger time: no fetch at all
    expect(h.fetchFn).not.toHaveBeenCalled()
    expect(h.reload).not.toHaveBeenCalled()
    input.blur()
    await h.check() // next trigger fetches immediately (throttle was not burned) and reloads
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    expect(h.reload).toHaveBeenCalledTimes(1)
  })

  it('is vetoed by a registered blocker and proceeds once it clears', async () => {
    const h = makeHarness()
    let draft = 'unsent message'
    const unregister = registerReloadBlocker(() => draft !== '')
    try {
      await h.check()
      expect(h.reload).not.toHaveBeenCalled()
      draft = ''
      await h.check()
      expect(h.reload).toHaveBeenCalledTimes(1)
    } finally {
      unregister()
    }
  })

  it('fails closed when a blocker throws', async () => {
    const h = makeHarness()
    const unregister = registerReloadBlocker(() => {
      throw new Error('broken blocker')
    })
    try {
      await h.check()
      expect(h.reload).not.toHaveBeenCalled()
    } finally {
      unregister()
    }
  })

  it('re-checks safety after the fetch round-trip, then uses the pending sha without refetching', async () => {
    const h = makeHarness()
    const input = document.createElement('input')
    document.body.appendChild(input)
    h.fetchFn.mockImplementation(() => {
      input.focus() // typing begins while the request is in flight
      return Promise.resolve(htmlResponse(distHtml(SHA_NEW)))
    })
    await h.check()
    expect(h.reload).not.toHaveBeenCalled()
    input.blur()
    await h.check() // pending fast path: reloads with no second fetch
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    expect(h.reload).toHaveBeenCalledTimes(1)
  })

  it('falls back to an in-memory guard when storage throws', async () => {
    const h = makeHarness({
      storage: {
        getItem: () => {
          throw new Error('storage denied')
        },
        setItem: () => {
          throw new Error('storage denied')
        },
      },
    })
    await h.check()
    expect(h.reload).toHaveBeenCalledTimes(1)
    h.advance(61_000)
    await h.check() // in-memory guard must still suppress the repeat
    expect(h.reload).toHaveBeenCalledTimes(1)
  })
})
