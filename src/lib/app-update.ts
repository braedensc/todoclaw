import * as Sentry from '@sentry/react'

// Installed-PWA auto-update (the missing half of every mobile viewport fix so far).
//
// iOS persists a Home-Screen web app's document so aggressively — process-resume, then a
// serialized bfcache-style restore that survives even force-quit — that a deployed fix can
// keep NOT loading for days: the document never re-navigates, so Vercel's max-age=0 /
// must-revalidate on index.html never gets a chance to serve the new build, and the service
// worker is push-only (no fetch handler), so vite-plugin-pwa's autoUpdate reload never fires
// either. Every installed user effectively runs the app pinned to whatever build they last
// cold-loaded (#317's fix was invisible for exactly this reason).
//
// Mechanism: the build bakes the deploying commit into index.html as <meta name="build-sha">
// (vite.config.ts, same VERCEL_GIT_COMMIT_SHA that feeds Sentry releases). On every resume of
// the document (pageshow / visibilitychange→visible / focus, plus a slow interval for
// never-backgrounded documents) the client re-fetches `/` with cache:'no-store' — atomic with
// the deploy by construction: it answers exactly "what build would a reload give me right
// now?" — and reloads once when the served sha differs from the running bundle's
// __GIT_COMMIT_SHA__. Reloading only ever happens at a safe moment: never while a text field
// is focused or a registered blocker (e.g. an unsent chat draft) objects.
//
// Loop safety: a localStorage guard remembers the target sha we last reloaded for (30 min TTL)
// so a misbehaving CDN edge can cost at most one wasted reload per target sha per window —
// converges, never loops. localStorage (not sessionStorage) so the guard survives force-quit
// and stays correctly per-context under iOS's tab↔installed-PWA storage partitioning (#221).
// Local/CI/dev builds have an empty __GIT_COMMIT_SHA__, which hard-disables the whole feature.
//
// Known, accepted edge: our reload can be followed by the browser's own SW update check
// re-reloading once via the pre-existing autoUpdate 'activated' handler — bounded at two
// back-to-back navigations, then the shas match.

const RELOAD_GUARD_KEY = 'todoclaw:update-reload'
const CHECK_THROTTLE_MS = 60_000
const MIN_PAGE_AGE_MS = 60_000
const RELOAD_GUARD_TTL_MS = 30 * 60_000
const FETCH_TIMEOUT_MS = 5_000
const IDLE_CHECK_INTERVAL_MS = 30 * 60_000

/** Extract the deploy marker from a served index.html. Strict hex-sha shape so captive
 *  portals, error pages, and empty local markers all read as "no marker" (null). */
export function parseBuildSha(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const content = doc.querySelector('meta[name="build-sha"]')?.getAttribute('content') ?? ''
  return /^[0-9a-f]{7,40}$/.test(content) ? content : null
}

type ReloadBlocker = () => boolean
const blockers = new Set<ReloadBlocker>()

/** Veto an auto-update reload while `fn` returns true (e.g. an unsent chat draft exists).
 *  Returns the unsubscribe — usable directly as a useEffect cleanup. Any new long-form
 *  composer/editor surface must register one of these. */
export function registerReloadBlocker(fn: ReloadBlocker): () => void {
  blockers.add(fn)
  return () => {
    blockers.delete(fn)
  }
}

export interface UpdateCheckerDeps {
  /** The running bundle's own sha (__GIT_COMMIT_SHA__). Empty string disables all checks. */
  currentSha: string
  fetchFn: typeof fetch
  reload: () => void
  /** localStorage, or null where unavailable — falls back to an in-memory guard. */
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  doc: Document
  now: () => number
  /** Milliseconds since page load (performance.now) — cold launches are fresh by definition. */
  pageAgeMs: () => number
  onReload?: (from: string, to: string) => void
}

function isEditable(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  return el instanceof HTMLElement && el.isContentEditable
}

export function createUpdateChecker(deps: UpdateCheckerDeps): { check: () => Promise<void> } {
  let lastCheckAt = -Infinity
  let pendingSha: string | null = null
  let memoryGuard: { sha: string; at: number } | null = null

  function safeNow(): boolean {
    if (isEditable(deps.doc.activeElement)) return false
    for (const b of blockers) {
      try {
        if (b()) return false
      } catch {
        return false // a broken blocker must fail closed, not force a reload
      }
    }
    return true
  }

  function readGuard(): { sha: string; at: number } | null {
    if (!deps.storage) return memoryGuard
    try {
      const raw = deps.storage.getItem(RELOAD_GUARD_KEY)
      if (!raw) return null
      const parsed: unknown = JSON.parse(raw)
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { sha?: unknown }).sha === 'string' &&
        typeof (parsed as { at?: unknown }).at === 'number'
      ) {
        return parsed as { sha: string; at: number }
      }
      return null
    } catch {
      return memoryGuard
    }
  }

  function writeGuard(sha: string): void {
    const record = { sha, at: deps.now() }
    memoryGuard = record
    try {
      deps.storage?.setItem(RELOAD_GUARD_KEY, JSON.stringify(record))
    } catch {
      // memoryGuard already covers this session
    }
  }

  function reloadFor(sha: string): void {
    const guard = readGuard()
    if (guard && guard.sha === sha && deps.now() - guard.at < RELOAD_GUARD_TTL_MS) {
      // Already reloaded for this exact target recently and we're STILL not on it — a stale
      // CDN edge. Drop it; a later check retries after the guard expires.
      pendingSha = null
      return
    }
    pendingSha = null
    writeGuard(sha) // BEFORE reload: a reload that fails to stick must not retry unguarded
    deps.onReload?.(deps.currentSha, sha)
    deps.reload()
  }

  async function check(): Promise<void> {
    if (!deps.currentSha) return
    if (deps.doc.visibilityState !== 'visible') return
    if (deps.pageAgeMs() < MIN_PAGE_AGE_MS) return
    // A mismatch already found but vetoed earlier: re-decide without refetching.
    if (pendingSha && safeNow()) {
      reloadFor(pendingSha)
      return
    }
    if (deps.now() - lastCheckAt < CHECK_THROTTLE_MS) return
    // Vetoed at trigger time (user is typing): skip WITHOUT burning the throttle window, so the
    // next trigger after they stop can fetch immediately.
    if (!safeNow()) return
    lastCheckAt = deps.now()
    let html: string
    try {
      const res = await deps.fetchFn('/', {
        cache: 'no-store',
        redirect: 'follow',
        signal:
          typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
            : undefined,
      })
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return
      html = await res.text()
    } catch {
      return // offline / timeout / captive gateway: silent no-op, retry on a later trigger
    }
    const sha = parseBuildSha(html)
    if (!sha || sha === deps.currentSha) {
      pendingSha = null
      return
    }
    // The user may have started typing during the fetch round-trip — re-check.
    if (!safeNow()) {
      pendingSha = sha
      return
    }
    reloadFor(sha)
  }

  return { check }
}

/** Wire the checker to the document lifecycle. Call once from main.tsx, after registerSW. */
export function initAppUpdate(): void {
  const checker = createUpdateChecker({
    currentSha: __GIT_COMMIT_SHA__,
    fetchFn: (input, init) => fetch(input, init),
    reload: () => window.location.reload(),
    storage: (() => {
      try {
        return window.localStorage
      } catch {
        return null
      }
    })(),
    doc: document,
    now: Date.now,
    pageAgeMs: () => performance.now(),
    onReload: (from, to) => Sentry.addBreadcrumb({ category: 'app-update', data: { from, to } }),
  })
  const trigger = () => {
    void checker.check()
  }
  // The resume trio proven for iOS PWAs in use-local-today.ts, plus a slow interval for
  // documents that never background.
  window.addEventListener('pageshow', trigger)
  window.addEventListener('focus', trigger)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') trigger()
  })
  setInterval(trigger, IDLE_CHECK_INTERVAL_MS)
}
