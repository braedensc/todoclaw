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
//   - "Plan My Day" needs a server-side Anthropic key that doesn't exist locally — expected to
//     fail; everything else works fully offline (React/Babel are bundled under scripts/vendor/).
//   - Editing tasks POSTs back and MUTATES planning/eisenclaw-export/data/planner-braeden.json
//     (auto-backup to data/backups/, max 10 kept). View-only if you want the seed pristine.

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveEisenclawDataDir } from './eisenclaw-seed/source'

// resolveEisenclawDataDir() returns .../eisenclaw-export/data (worktree-aware; it falls back to
// the main checkout because planning/ is gitignored). The server + html + vendor sit alongside it.
const scriptsDir = join(dirname(resolveEisenclawDataDir()), 'scripts')
const serverPath = join(scriptsDir, 'planner-server.js')

// The reference server derives DATA_DIR/HTML_PATH/VENDOR_DIR from __dirname; our temp copy lives
// elsewhere, so pin __dirname to the real scripts dir. Every __dirname in that file is a
// standalone token used as a path.join base, so a word-boundary replace is exact and total.
const patched = readFileSync(serverPath, 'utf8').replace(
  /\b__dirname\b/g,
  JSON.stringify(scriptsDir),
)

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
