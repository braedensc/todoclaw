import path from 'node:path'

// Shared output locations for the device lab (spec + seed + teardown). Rooted at cwd — the repo
// root when run via `npm run device-lab` — and gitignored (screenshots are artifacts, not source).
export const REPORT_DIR = path.resolve(process.cwd(), 'device-lab-report')
export const SHOTS_DIR = path.join(REPORT_DIR, 'shots')

/** Filesystem-safe slug for device / scenario names ("iPhone 15 Pro Max" → "iphone-15-pro-max"). */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
