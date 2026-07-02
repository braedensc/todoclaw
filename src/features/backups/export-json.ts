import type { Task } from '../../types/task'
import type { Habit } from '../../types/habit'

// Client-side JSON export — a portability escape hatch alongside the in-DB snapshots: download
// the current planner content as a plain JSON file you own. Export only; there is deliberately
// no import path (restore is via the in-app snapshots, so we avoid an untrusted-file import
// surface). The build step is pure and unit-tested; downloadJson is the browser glue.

export interface PlannerExport {
  version: 1
  exportedAt: string
  tasks: Task[]
  habits: Habit[]
}

/** Build the export payload from the current live tasks + habits. Pure (inject `now` in tests). */
export function buildPlannerExport(
  tasks: Task[],
  habits: Habit[],
  now: Date = new Date(),
): PlannerExport {
  return { version: 1, exportedAt: now.toISOString(), tasks, habits }
}

/** A filesystem-safe, timestamped export filename, e.g. `todoclaw-backup-2026-07-02.json`. */
export function exportFilename(now: Date = new Date()): string {
  return `todoclaw-backup-${now.toISOString().slice(0, 10)}.json`
}

/**
 * Trigger a browser download of `content` as pretty-printed JSON. Browser-only: uses a Blob +
 * a temporary object URL; no-ops when there is no `document` (jsdom/SSR) so callers/tests are
 * safe. Not the logic under test — `buildPlannerExport` is.
 */
export function downloadJson(filename: string, content: unknown): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Defer the revoke: some browsers read the blob for the download asynchronously after click(),
  // and revoking in the same tick can yield an empty/failed download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
