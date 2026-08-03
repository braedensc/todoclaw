// sql-scan.mjs — shared, deterministic SQL-text primitives for the migration guards
// (check-write-caps.mjs, check-definer-grants.mjs). No deps, no DB — a fast textual scan of the
// migration files, comments stripped. The value of factoring these out is a SINGLE robust parser:
// naïve one-shot regexes with lazy quantifiers (`\([\s\S]*?\)`, `\$(\w*)\$…\$\2\$`) silently
// cross-contaminate when run over the whole concatenated corpus — an arg list or dollar body can
// "reach" across unrelated function definitions and mis-associate. Everything here is anchored:
// balanced-paren scans for arg lists, exact-tag matching for dollar-quoted bodies, and per-statement
// (`;`-bounded) grant parsing.

import { readdirSync, readFileSync } from 'node:fs'

// Strip block then line comments so DDL mentioned inside a comment — notably the `-- down:` reversal
// block every migration documents — is never mistaken for a real statement.
export function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

// Read + strip every *.sql in `dir`, sorted. Returns { files, all } where `all` is the concatenation
// (the corpus the guards scan) and `files` is the sorted list (for "created in <file>" messages).
export function loadMigrations(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const perFile = files.map((f) => stripComments(readFileSync(`${dir}/${f}`, 'utf8')))
  return { files, perFile, all: perFile.join('\n') }
}

// Match a balanced-paren span starting at `open` (which must index a '('). Returns the index of the
// matching ')' or -1. Used for function arg lists, which nest parens (defaults, types).
function matchParen(sql, open) {
  let depth = 0
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++
    else if (sql[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// Parse every `create [or replace] function [public.]<name>(<args>) <header> $tag$ <body> $tag$`.
// Robust to overloads and to non-trigger functions interleaved with trigger ones, because each
// function is consumed as a unit: balanced arg list, then the header up to the opening dollar tag,
// then the body up to the SAME closing tag (Postgres guarantees the tag does not occur in the body).
// Returns [{ name, args, header, body, security, returnsTrigger }] with header/body lowercased.
export function parseFunctions(sql) {
  const out = []
  const head = /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi
  let m
  while ((m = head.exec(sql))) {
    const name = m[1].toLowerCase()
    const openParen = m.index + m[0].length - 1 // index of the '(' that opens the arg list
    const closeParen = matchParen(sql, openParen)
    if (closeParen < 0) {
      head.lastIndex = openParen + 1
      continue
    }
    const args = sql.slice(openParen + 1, closeParen).trim()
    // Header runs from after the args to the first `$tag$`. If the function has no dollar body (rare
    // — SQL-language one-liners), treat the rest up to the next `;` as the header.
    const dq = /\$(\w*)\$/g
    dq.lastIndex = closeParen + 1
    const open = dq.exec(sql)
    let header, body, nextFrom
    if (open) {
      header = sql.slice(closeParen + 1, open.index)
      const tag = open[0]
      const close = sql.indexOf(tag, open.index + tag.length)
      body = close >= 0 ? sql.slice(open.index + tag.length, close) : ''
      nextFrom = close >= 0 ? close + tag.length : open.index + tag.length
    } else {
      const semi = sql.indexOf(';', closeParen + 1)
      header = sql.slice(closeParen + 1, semi < 0 ? closeParen + 200 : semi)
      body = ''
      nextFrom = semi < 0 ? closeParen + 1 : semi + 1
    }
    const h = header.toLowerCase()
    out.push({
      name,
      args,
      header: h,
      body: body.toLowerCase(),
      security: /\bsecurity\s+definer\b/.test(h) ? 'definer' : 'invoker',
      returnsTrigger: /\breturns\s+trigger\b/.test(h),
    })
    head.lastIndex = nextFrom // resume PAST this whole function (never re-enter its body)
  }
  return out
}

// Parse `create [or replace] trigger <name> <timing> <events> on [public.]<table> … execute
// (function|procedure) [public.]<fn>`. Statement-bounded (`[^;]`) so it can't reach into the next
// statement. Returns [{ name, timing, events, table, fn }], all lowercased.
export function parseTriggers(sql) {
  const re =
    /create\s+(?:or\s+replace\s+)?trigger\s+"?(\w+)"?\s+(before|after|instead\s+of)\s+([^;]*?)\s+on\s+(?:"?public"?\.)?"?(\w+)"?[^;]*?execute\s+(?:function|procedure)\s+(?:"?public"?\.)?"?(\w+)"?/gi
  const out = []
  for (const m of sql.matchAll(re)) {
    out.push({
      name: m[1].toLowerCase(),
      timing: m[2].toLowerCase().replace(/\s+/g, ' '),
      events: m[3].toLowerCase(),
      table: m[4].toLowerCase(),
      fn: m[5].toLowerCase(),
    })
  }
  return out
}

// Parse GRANT / REVOKE statements, statement-bounded (`[^;]`). `objectKind` distinguishes a table
// grant from a `on function …` / `on sequence …` grant. Returns
// [{ action:'grant'|'revoke', privs, kind, schema, name, roles:[…] }], lowercased. `kind` is
// 'function' | 'sequence' | 'table' (the default when no object keyword is present).
export function parseGrants(sql) {
  const re =
    /\b(grant|revoke)\s+([^;]*?)\s+on\s+(function|sequence|table|all\s+tables\s+in\s+schema)?\s*(?:"?(\w+)"?\.)?"?(\w+)"?\s*(?:\([^)]*\))?\s+(to|from)\s+([^;]+)/gi
  const out = []
  for (const m of sql.matchAll(re)) {
    out.push({
      action: m[1].toLowerCase(),
      privs: m[2].toLowerCase(),
      kind: (m[3] || 'table').toLowerCase().replace(/\s+/g, ' '),
      schema: m[4] ? m[4].toLowerCase() : null,
      name: m[5].toLowerCase(),
      roles: m[7]
        .toLowerCase()
        .split(',')
        .map((r) => r.trim().replace(/"/g, ''))
        .filter(Boolean),
    })
  }
  return out
}
