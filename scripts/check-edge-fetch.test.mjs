// Fixture tests for the edge-fetch guard (scripts/check-edge-fetch.mjs). Every outbound fetch must
// pass a timeout; a dynamic (DB-sourced) URL must be host-allowlisted. Constant hosts and
// env-derived URLs are safe. Aliases of `fetch` count as fetches.

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanEdgeFetches, findEdgeFetchOffenders, stripJsComments } from './check-edge-fetch.mjs'

const dirs = []
function fns(files) {
  const dir = mkdtempSync(join(tmpdir(), 'edgefetch-'))
  dirs.push(dir)
  for (const [name, src] of Object.entries(files)) {
    const full = join(dir, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, src)
  }
  return dir
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true })
})

describe('edge-fetch guard', () => {
  it('FLAGS a fetch with a constant host but no timeout', () => {
    const dir = fns({
      'a/index.ts': `await fetch('https://api.example.com/x', { method: 'POST' })`,
    })
    const { offenders } = findEdgeFetchOffenders(dir, {})
    expect(offenders.length).toBe(1)
    expect(offenders[0].problems.join()).toMatch(/no AbortSignal/)
  })

  it('PASSES a fetch with a constant host and a timeout', () => {
    const dir = fns({
      'a/index.ts': `await fetch('https://api.example.com/x', { signal: AbortSignal.timeout(5000) })`,
    })
    expect(findEdgeFetchOffenders(dir, {}).offenders).toEqual([])
  })

  it('FLAGS a dynamic (DB-sourced) URL that is not host-allowlisted', () => {
    const dir = fns({
      'a/index.ts': `await fetch(row.endpoint, { signal: AbortSignal.timeout(5000) })`,
    })
    const { offenders } = findEdgeFetchOffenders(dir, {})
    expect(offenders.length).toBe(1)
    expect(offenders[0].problems.join()).toMatch(/SSRF|dynamic/)
  })

  it('PASSES a dynamic URL once it is host-allowlisted (and has a timeout)', () => {
    const dir = fns({
      'a/index.ts': `await fetch(row.endpoint, { signal: AbortSignal.timeout(5000) })`,
    })
    const allow = { 'a/index.ts:row.endpoint': 'reviewed: owner-registered endpoint' }
    expect(findEdgeFetchOffenders(dir, allow).offenders).toEqual([])
  })

  it('treats a Deno.env.get URL as env-derived (not SSRF), still requires a timeout', () => {
    const dir = fns({
      'a/index.ts': `
        const url = Deno.env.get('WEBHOOK_URL')
        await fetch(url, { method: 'POST', signal: AbortSignal.timeout(3000) })`,
    })
    const calls = scanEdgeFetches(dir)
    expect(calls[0].urlKind).toBe('env')
    expect(findEdgeFetchOffenders(dir, {}).offenders).toEqual([])
  })

  it('detects fetch ALIASES (typeof fetch param + `= … fetch` binding)', () => {
    const dir = fns({
      'a/index.ts': `
        export async function send(sub, opts: { fetchImpl?: typeof fetch } = {}) {
          const doFetch = opts.fetchImpl ?? fetch
          return doFetch(sub.endpoint, { method: 'POST' })
        }`,
    })
    const calls = scanEdgeFetches(dir)
    const aliasCall = calls.find((c) => c.callee === 'doFetch')
    expect(aliasCall).toBeTruthy()
    expect(aliasCall.hasSignal).toBe(false)
    expect(aliasCall.urlKind).toBe('dynamic')
  })

  it('does NOT flag a fetch mentioned only in a comment', () => {
    const dir = fns({
      'a/index.ts': `
        // Historically we used to fetch(badUrl) here with no timeout — do not reintroduce.
        await fetch('https://api.example.com/x', { signal: AbortSignal.timeout(1000) })`,
    })
    const calls = scanEdgeFetches(dir)
    expect(calls.length).toBe(1) // only the real one
    expect(findEdgeFetchOffenders(dir, {}).offenders).toEqual([])
  })

  it('ignores *.test.ts files', () => {
    const dir = fns({
      'a/index.test.ts': `await fetch(whatever, {})`,
    })
    expect(scanEdgeFetches(dir)).toEqual([])
  })

  it('stripJsComments keeps // inside strings but removes real comments', () => {
    const stripped = stripJsComments(`const u = 'https://x/y' // trailing comment`)
    expect(stripped).toContain(`'https://x/y'`)
    expect(stripped).not.toContain('trailing comment')
  })
})
