import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OldPlannerState, OldUserSchedule } from './types'

const PLANNER_RELATIVE_PATH = 'planning/eisenclaw-export/data/planner-braeden.json'

// Locate the (gitignored) planning/ reference data. It is never committed, so a fresh git
// worktree — which only checks out TRACKED files — won't have it even though the main checkout
// does (this repo runs multi-session work in worktrees; see docs/COLLABORATION.md). Falls back
// to the main worktree before giving up with an actionable error.
export function resolveEisenclawDataDir(): string {
  const override = process.env.EISENCLAW_SEED_DIR
  if (override) {
    if (!existsSync(join(override, 'planner-braeden.json'))) {
      throw new Error(`EISENCLAW_SEED_DIR="${override}" does not contain planner-braeden.json.`)
    }
    return override
  }

  const candidates = [
    join(process.cwd(), 'planning/eisenclaw-export/data'),
    ...mainWorktreeCandidate(),
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'planner-braeden.json'))) return dir
  }

  throw new Error(
    `Could not find ${PLANNER_RELATIVE_PATH}.\n` +
      "planning/ is gitignored, so a fresh git worktree checkout won't have it — only the " +
      'main checkout does. Run this from the main checkout, or set EISENCLAW_SEED_DIR to a ' +
      'copy of planning/eisenclaw-export/data.',
  )
}

function mainWorktreeCandidate(): string[] {
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' })
    // Each worktree record is a blank-line-separated block; the first is the main worktree.
    const first = out.split('\n\n')[0] ?? ''
    const match = first.match(/^worktree (.+)$/m)
    return match ? [join(match[1], 'planning/eisenclaw-export/data')] : []
  } catch {
    return []
  }
}

export function readPlannerState(dataDir: string): OldPlannerState {
  return JSON.parse(readFileSync(join(dataDir, 'planner-braeden.json'), 'utf8')) as OldPlannerState
}

export function readUserSchedule(dataDir: string): OldUserSchedule | null {
  const path = join(dataDir, 'user-schedule-braeden.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as OldUserSchedule
}

export interface BackupSnapshot {
  filename: string
  takenAt: string | null // best-effort timestamp parsed from the filename
  state: OldPlannerState
}

// The 10 auto-snapshots the old server kept (data/backups/*.json, same OldPlannerState shape as
// the live file). Optional — only read when the caller asks for --with-backups.
export function readBackupSnapshots(dataDir: string): BackupSnapshot[] {
  const backupsDir = join(dataDir, 'backups')
  if (!existsSync(backupsDir)) return []

  return readdirSync(backupsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((filename) => ({
      filename,
      takenAt: parseTimestampFromFilename(filename),
      state: JSON.parse(readFileSync(join(backupsDir, filename), 'utf8')) as OldPlannerState,
    }))
}

// planner-braeden-2026-05-19_04-19-19.json -> 2026-05-19T04:19:19.000Z
function parseTimestampFromFilename(filename: string): string | null {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/)
  if (!match) return null
  const [, date, hh, mm, ss] = match
  return `${date}T${hh}:${mm}:${ss}.000Z`
}
