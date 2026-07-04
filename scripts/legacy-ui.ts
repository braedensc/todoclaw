#!/usr/bin/env -S node --import tsx
// Dev-only convenience: run the ORIGINAL EisenClaw planner server locally so we can view the
// legacy UI while porting (todoclaw item 18). The reference app lives (gitignored) under
// planning/eisenclaw-export/; its server is pure CommonJS with zero npm deps, but this repo's
// package.json is "type":"module", so `node planner-server.js` crashes with "require is not
// defined". We must never modify anything under planning/, so instead we copy the server to a
// temp .cjs (CommonJS by extension), repoint its three __dirname-relative paths at the real
// reference dir, and run that. The real html/vendor/data are served unchanged.
//
// Usage:  npm run legacy-ui   (Ctrl-C to stop)
//
// Notes:
//   - Serves http://127.0.0.1:3333 (Braeden's real data) and ?user=fan (empty profile).
//   - "Plan My Day" is stubbed with a local MOCK so the UX is viewable offline (see mock injection
//     below) — the real endpoint needs a server-side Anthropic key that doesn't exist locally.
//     Everything else works fully offline (React/Babel are bundled under scripts/vendor/).
//   - Editing tasks POSTs back and MUTATES planning/eisenclaw-export/data/planner-braeden.json
//     (auto-backup to data/backups/, max 10 kept). View-only if you want the seed pristine.

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveEisenclawDataDir } from './eisenclaw-seed/source'

const here = dirname(fileURLToPath(import.meta.url))

// resolveEisenclawDataDir() returns .../eisenclaw-export/data (worktree-aware; it falls back to
// the main checkout because planning/ is gitignored). The server + html + vendor sit alongside it.
const scriptsDir = join(dirname(resolveEisenclawDataDir()), 'scripts')
const serverPath = join(scriptsDir, 'planner-server.js')

// The reference server derives DATA_DIR/HTML_PATH/VENDOR_DIR from __dirname; our temp copy lives
// elsewhere, so pin __dirname to the real scripts dir. Every __dirname in that file is a
// standalone token used as a path.join base, so a word-boundary replace is exact and total.
let patched = readFileSync(serverPath, 'utf8').replace(/\b__dirname\b/g, JSON.stringify(scriptsDir))

// Stub Plan My Day with a local mock so its UX renders without an Anthropic key. The reference
// server's /api/plan handler bails with a 500 when getAnthropicKey() returns null; swap that
// no-key branch to return our deterministic mock instead, and append the mock's source (a hoisted
// `function __legacyUiMockPlan`). If a real key IS present, the real branch is untouched.
const NO_KEY_BRANCH = `      if (!apiKey) {
        send(res, 500, { ok: false, error: 'Anthropic API key not found.' });
        return;
      }`
const MOCK_BRANCH = `      if (!apiKey) {
        // [legacy-ui] No local key — return a deterministic mock so the Plan My Day UX is viewable
        // offline (injected by scripts/legacy-ui.ts + legacy-ui-mock-plan.cjs). Real path unchanged.
        send(res, 200, { ok: true, plan: __legacyUiMockPlan(parsed) });
        return;
      }`
if (patched.includes(NO_KEY_BRANCH)) {
  const mockSrc = readFileSync(join(here, 'legacy-ui-mock-plan.cjs'), 'utf8')
  patched = patched.replace(NO_KEY_BRANCH, MOCK_BRANCH) + '\n\n' + mockSrc
} else {
  // Reference server changed shape — degrade gracefully: the UI still runs, but Plan My Day will
  // show its original "API key not found" error instead of the mock.
  console.warn(
    '[legacy-ui] Could not find the /api/plan no-key branch to stub; Plan My Day mock is disabled.',
  )
}

const workDir = mkdtempSync(join(tmpdir(), 'eisenclaw-legacy-ui-'))
const tempServer = join(workDir, 'planner-server.cjs')
writeFileSync(tempServer, patched)

const cleanup = () => rmSync(workDir, { recursive: true, force: true })

const child = spawn(process.execPath, [tempServer], { stdio: 'inherit' })

child.on('exit', (code) => {
  cleanup()
  process.exit(code ?? 0)
})

// Forward Ctrl-C / termination to the child; its 'exit' handler runs cleanup.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal))
}
