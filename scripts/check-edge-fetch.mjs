// check-edge-fetch.mjs — deterministic lint over every outbound fetch in supabase/functions. Edge
// Functions run server-side with the service_role key and reach the public internet, so an
// unguarded fetch is two security-invariant classes at once:
//   1. AVAILABILITY / cron-hang — a fetch with no timeout can block forever. The web-push send loop
//      (dispatch-messages / dispatch-reminders → sendWebPush) POSTs to each user's push endpoint in
//      turn; one endpoint that accepts the connection and never responds would wedge the whole cron
//      dispatch. EVERY fetch must pass an AbortSignal/timeout.
//   2. SSRF — a fetch whose URL comes from user-stored DB data lets a user point the server at an
//      arbitrary host (including internal/metadata addresses). A URL sourced from the database must
//      be a hardcoded host, or be reviewed and recorded in EDGE_FETCH_URL_ALLOWLIST with a note on
//      why its (dynamic) host is safe.
// See CLAUDE.md "Security Model" — this is the outbound-request companion to the DB-layer guards.
//
// WHAT COUNTS AS A FETCH. `fetch` itself, plus local ALIASES: a parameter typed `typeof fetch`
// (the injectable `fetchImpl` test seam) and any `const x = … fetch` binding (e.g.
// `const doFetch = opts.fetchImpl ?? fetch`). The real web-push call is `doFetch(subscription.endpoint,
// …)`, not a literal `fetch(` — a name-only grep would miss it.
//
// URL CLASSIFICATION (first argument):
//   • constant host  — a string/template literal whose scheme://host has no `${…}` interpolation
//                      (`https://wttr.in/${loc}` is fine: only the PATH is dynamic). SAFE.
//   • env-derived    — the URL is `Deno.env.get(…)` (directly, or a local `const x = Deno.env.get(…)`).
//                      Operator-configured, not user data. SAFE.
//   • dynamic        — anything else (a bare identifier / member expr like `subscription.endpoint`).
//                      Must be in EDGE_FETCH_URL_ALLOWLIST or it FAILS.
//
// SCOPE: static text scan, comments stripped (string-aware, so `https://` inside a string is never
// mistaken for a line comment). It proves a `signal` is PASSED and the URL host is constant/reviewed;
// it does not prove the timeout value is sane. Fast, no deps, runs on every PR.
//
// Usage:  node scripts/check-edge-fetch.mjs      # exit 0 = every edge fetch is bounded + host-safe; 1 = offender(s)

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { argv, exit } from 'node:process'

const DIR = 'supabase/functions'

// ─── ALLOWLIST ──────────────────────────────────────────────────────────────────────────────────
// Dynamic-URL fetches (host not a constant literal, not env-derived) that have been REVIEWED. Key =
// `<path under supabase/functions>:<url-expression>`; changing either forces a fresh review. Every
// entry states why the dynamic host is acceptable. A timeout is ALWAYS required — there is no
// allowlist for a missing signal.
export const EDGE_FETCH_URL_ALLOWLIST = {
  '_shared/web-push.ts:subscription.endpoint':
    'Web Push endpoint is a push-service URL (FCM / Mozilla / WNS / Apple) the OWNER registered for their own browser; the set of hosts is open by design and cannot be allowlisted. Integrity rests on push_subscriptions being owner-only (RLS insert scoped to auth.uid()) and the payload being the user’s own notification. Timeout is enforced (checked separately).',
}

// ─── string-aware comment stripper ──────────────────────────────────────────────────────────────
// Blank out // and /* */ comments while preserving string/template contents verbatim, so a URL like
// 'https://host/x' is never truncated at its '//'. Template `${…}` is copied verbatim (our URL
// templates never nest a backtick inside the expression).
export function stripJsComments(src) {
  let out = ''
  let mode = 'code' // code | line | block | sq | dq | tpl
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const c2 = src[i + 1]
    if (mode === 'code') {
      if (c === '/' && c2 === '/') {
        mode = 'line'
        out += '  '
        i++
      } else if (c === '/' && c2 === '*') {
        mode = 'block'
        out += '  '
        i++
      } else {
        if (c === "'") mode = 'sq'
        else if (c === '"') mode = 'dq'
        else if (c === '`') mode = 'tpl'
        out += c
      }
    } else if (mode === 'line') {
      if (c === '\n') {
        mode = 'code'
        out += c
      } else out += ' '
    } else if (mode === 'block') {
      if (c === '*' && c2 === '/') {
        mode = 'code'
        out += '  '
        i++
      } else out += c === '\n' ? '\n' : ' '
    } else {
      // string / template: copy verbatim, honor escapes, end on the matching quote
      out += c
      if (c === '\\') {
        out += src[i + 1] ?? ''
        i++
      } else if (
        (mode === 'sq' && c === "'") ||
        (mode === 'dq' && c === '"') ||
        (mode === 'tpl' && c === '`')
      ) {
        mode = 'code'
      }
    }
  }
  return out
}

// ─── call-argument extraction ───────────────────────────────────────────────────────────────────
// From the '(' at `open`, return { args:[trimmed top-level args], end } respecting nested
// ()/[]/{} and strings. `src` must already be comment-stripped.
function extractArgs(src, open) {
  const args = []
  let depth = 0
  let cur = ''
  let str = null // "'" | '"' | '`' when inside a string
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (str) {
      cur += c
      if (c === '\\') {
        cur += src[i + 1] ?? ''
        i++
      } else if (c === str) str = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      str = c
      cur += c
      continue
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++
      if (depth === 1 && c === '(') continue // skip the opening call paren itself
      cur += c
    } else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) {
        if (cur.trim()) args.push(cur.trim())
        return { args, end: i }
      }
      cur += c
    } else if (c === ',' && depth === 1) {
      args.push(cur.trim())
      cur = ''
    } else {
      cur += c
    }
  }
  return { args, end: src.length }
}

// The fetch-like callee names in a source: `fetch` plus aliases (typeof-fetch params, `= … fetch`
// bindings). Excludes `= fetch(` (that's a CALL of fetch, whose result is not itself fetch).
function fetchCalleeNames(src) {
  const names = new Set(['fetch'])
  for (const m of src.matchAll(/(\w+)\s*\??\s*:\s*typeof\s+fetch\b/g)) names.add(m[1])
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*\bfetch\b(?!\s*\()/g)) {
    names.add(m[1])
  }
  return names
}

// Classify a URL argument expression. `src` is the whole (stripped) file for env back-references.
function classifyUrl(urlExpr, src) {
  const s = urlExpr.trim()
  // constant-host string / template literal: quote, scheme, host, then '/' or end — no ${ in host.
  const lit = /^['"`]https?:\/\/([^/\s'"`?#]+)/i.exec(s)
  if (lit && !lit[1].includes('${')) return 'constant-host'
  // env-derived, directly or via a local binding.
  if (/\bDeno\.env\.get\s*\(/.test(s)) return 'env'
  const idMatch = /^[A-Za-z_$][\w$]*$/.exec(s)
  if (idMatch) {
    const bind = new RegExp(
      `(?:const|let|var)\\s+${s.replace(/[$]/g, '\\$')}\\s*=\\s*[^\\n;]*Deno\\.env\\.get\\s*\\(`,
    )
    if (bind.test(src)) return 'env'
  }
  return 'dynamic'
}

// ─── scan ───────────────────────────────────────────────────────────────────────────────────────
function walkTsFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`
    const st = statSync(p)
    if (st.isDirectory()) walkTsFiles(p, acc)
    else if (name.endsWith('.ts') && !/\.test\.ts$/.test(name)) acc.push(p)
  }
  return acc
}

// Returns every fetch call site with its findings. `root` defaults to supabase/functions.
export function scanEdgeFetches(root = DIR) {
  const results = []
  for (const file of walkTsFiles(root).sort()) {
    const rel = file.slice(root.length + 1)
    const src = stripJsComments(readFileSync(file, 'utf8'))
    const callees = fetchCalleeNames(src)
    for (const callee of callees) {
      const callRe = new RegExp(`(^|[^.\\w])${callee}\\s*\\(`, 'g')
      let m
      while ((m = callRe.exec(src))) {
        const open = m.index + m[0].length - 1 // the '('
        const { args } = extractArgs(src, open)
        if (!args.length) continue
        const urlExpr = args[0]
        const optionsText = args.slice(1).join(',')
        const urlKind = classifyUrl(urlExpr, src)
        const hasSignal = /\bsignal\b/.test(optionsText)
        results.push({ rel, callee, urlExpr, urlKind, hasSignal, line: lineOf(src, m.index) })
      }
    }
  }
  return results
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length
}

export function findEdgeFetchOffenders(root = DIR, allowlist = EDGE_FETCH_URL_ALLOWLIST) {
  const calls = scanEdgeFetches(root)
  const offenders = []
  for (const call of calls) {
    const problems = []
    if (!call.hasSignal) problems.push('no AbortSignal/timeout (can hang the cron)')
    if (call.urlKind === 'dynamic') {
      const key = `${call.rel}:${call.urlExpr}`
      if (!Object.prototype.hasOwnProperty.call(allowlist, key)) {
        problems.push('URL host is dynamic (possible SSRF) and not host-allowlisted')
      }
    }
    if (problems.length) offenders.push({ ...call, problems })
  }
  const usedKeys = new Set(
    calls.filter((c) => c.urlKind === 'dynamic').map((c) => `${c.rel}:${c.urlExpr}`),
  )
  const staleAllowlist = Object.keys(allowlist).filter((k) => !usedKeys.has(k))
  return { calls, offenders, staleAllowlist }
}

function runCli(root = DIR) {
  const { calls, offenders, staleAllowlist } = findEdgeFetchOffenders(root)

  for (const k of staleAllowlist) {
    console.warn(
      `⚠ EDGE_FETCH_URL_ALLOWLIST["${k}"] looks stale — no dynamic-URL fetch matches it anymore. ` +
        'Delete the entry.',
    )
  }

  if (offenders.length) {
    console.error('✖ Edge-fetch guard failed — unguarded outbound fetch(es):\n')
    for (const o of offenders) {
      console.error(`  • ${o.rel}:${o.line}  ${o.callee}(${o.urlExpr}, …)`)
      for (const p of o.problems) console.error(`      – ${p}`)
    }
    console.error(
      '\nEvery fetch in supabase/functions must:\n' +
        '  • pass a timeout — `signal: AbortSignal.timeout(<ms>)` (or an AbortController signal); and\n' +
        '  • use a constant host, an env-configured URL, or — for a genuinely dynamic host — carry a\n' +
        '    reviewed entry in EDGE_FETCH_URL_ALLOWLIST (scripts/check-edge-fetch.mjs) explaining why\n' +
        '    the host is safe (this is the SSRF review).',
    )
    exit(1)
  }

  console.log(
    `✓ Edge-fetch guard: all ${calls.length} outbound fetch(es) in ${root} pass a timeout and use a ` +
      'constant/env/allowlisted host.',
  )
}

function invokedAsScript() {
  if (!argv[1]) return false
  try {
    return realpathSync(argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return argv[1] === fileURLToPath(import.meta.url)
  }
}
if (invokedAsScript()) runCli()
