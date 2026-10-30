import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// RAW-COLOR RATCHET (TOD-136, dark-mode epic TOD-135). Dark mode works by flipping the `--c-*`
// variables behind the Tailwind palette (src/index.css), so a color spelled any other way — a hex
// or rgb()/rgba() literal, a Tailwind default-palette class (`text-white`, `bg-red-50`), an
// arbitrary `[#hex]` — stays stuck in light mode. This read-only test fails on any such color in
// a non-test src/**/*.{ts,tsx,css} file that is not on ALLOWLIST below, and fails when an
// allowlisted file no longer has any (so the list can only shrink). Each later dark-mode child
// converts its files and deletes their entries here. Comments are ignored.

const root = process.cwd()

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const PREFIX =
  'bg|text|border|border-[trblxy]|ring|ring-offset|from|via|to|fill|stroke|outline|divide|shadow|accent|caret|decoration|placeholder'
const RAW_COLOR = new RegExp(
  [
    '#[0-9a-fA-F]{3,8}\\b',
    // rgb(var(--c-…)) / rgb(var(--c-…) / α) is the themed form (TOD-138), not a raw color.
    '\\brgba?\\((?!var\\(--c-)',
    `(?<![\\w-])(?:${PREFIX})-(?:(?:white|black|(?:${PALETTE})-\\d{2,3})(?![\\w-])|\\[#)`,
  ].join('|'),
  'g',
)

/** Drops block comments (CSS, JS, JSX `{/* … *\/}`) and `//` line comments (not `https://`). */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
}

export function rawColors(src) {
  return stripComments(src).match(RAW_COLOR) ?? []
}

// path → one-line reason it still carries raw colors. Shrink only.
const ALLOWLIST = {
  'src/index.css': 'rgba() merge-preview shadows on grid cards and cluster bubbles',
  'src/components/TodoClawIcon.tsx': 'mascot SVG artwork fills',
  'src/components/TodoClawPeek.tsx': 'mascot SVG artwork fills',
  'src/features/ai/ChatConversation.tsx': 'text-white and [#hex] text on fills',
  'src/features/ai/ChatSessionList.tsx': 'text-white on a solid fill',
  'src/features/ai/PlanBox.tsx': 'text-white and a [#hex] chip background',
  'src/features/auth/AuthMascot.tsx': 'mascot SVG artwork fills',
  'src/features/backups/BackupsPanel.tsx': 'text-white on a solid fill',
  'src/features/clustering/ClusterBubble.tsx': 'inline rgba() box-shadows',
  'src/features/clustering/ClusterPopup.tsx': 'bg-white surface and text-white on a fill',
  'src/features/done/DoneView.tsx': 'deleted-task accent hex and text-white on a fill',
  'src/features/grid/GridCard.tsx': 'inline rgba() drag shadow and text-white on a fill',
  'src/features/grid/GridSurface.tsx': 'text-white pill and ring-black',
  'src/features/grid/PawTrail.tsx': 'paw SVG fill hex',
  'src/features/grid/TouchCardPopover.tsx': 'text-white on a solid fill',
  'src/features/grid/TouchGridChip.tsx': 'text-white on a solid fill',
  'src/features/grid/TouchGridSurface.tsx':
    'inline rgba() lift shadow, text-white pill, ring-black',
  'src/features/grid/TouchTaskSheet.tsx': 'text-white on a solid fill',
  'src/features/habits/HabitCheck.tsx': 'text-white on the puppy fill',
  'src/features/habits/HabitsView.tsx': 'text-white on a solid fill',
  'src/features/habits/RemindersInline.tsx': 'text-white on a solid fill',
  'src/features/list/ExpandedRow.tsx': 'slider accent hex props and text-white on a fill',
  'src/features/onboarding/AppSetupWizard.tsx': 'text-white on solid fills',
  'src/features/onboarding/DemoScene.tsx': 'demo plan-pill gradient hex, [#hex] text, text-white',
  'src/features/onboarding/FeatureTour.tsx': 'inline rgba() spotlight scrim and text-white',
  'src/features/onboarding/InstallPanels.tsx': 'illustrated phone/browser mockup artwork',
  'src/features/onboarding/SetupGuide.tsx': 'text-white and [#hex] text',
  'src/features/reminders/ReminderPicker.tsx': 'text-white on a solid fill',
  'src/features/schedule/SchedulePanel.tsx': 'text-white on solid fills',
  'src/features/schedule/TimezoneMismatchBanner.tsx': 'text-white on a solid fill',
  'src/features/settings/InviteManager.tsx': 'text-white on a solid fill',
  'src/features/settings/SettingsPanel.tsx': 'text-white on a solid fill',
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const scanned = walk(resolve(root, 'src'))
  .map((p) => relative(root, p).split('\\').join('/'))
  .filter(
    (p) => /\.(ts|tsx|css)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.startsWith('src/test/'),
  )

const offenders = Object.fromEntries(
  scanned
    .map((p) => [p, rawColors(readFileSync(resolve(root, p), 'utf8'))])
    .filter(([, hits]) => hits.length > 0),
)

describe('raw-color matcher', () => {
  it('catches hex, rgb()/rgba() and default-palette classes', () => {
    expect(rawColors("color: '#2e2a24'")).toEqual(['#2e2a24'])
    expect(rawColors('box-shadow: 0 1px rgba(0,0,0,.1)')).toEqual(['rgba('])
    expect(rawColors('color: rgb(var(--other))')).toEqual(['rgb('])
    expect(rawColors('className="text-white hover:bg-red-600 border-[#fff]"')).toEqual([
      'text-white',
      'bg-red-600',
      'border-[#',
    ])
  })

  it('ignores comments, tokens and non-color hashes', () => {
    expect(rawColors('/* #2e2a24 */ // rgba(0,0,0,1)\nconst x = 1')).toEqual([])
    expect(rawColors('{/* text-white (#336) */}')).toEqual([])
    expect(rawColors('className="bg-ink text-on-ink bg-scrim/40 text-whitespace"')).toEqual([])
    expect(rawColors("fetch('https://example.com/a') // text-white")).toEqual([])
    expect(rawColors("document.querySelector('#root')")).toEqual([])
    expect(rawColors("color: 'rgb(var(--c-accent))', ring: 'rgb(var(--c-stale) / 0.6)'")).toEqual(
      [],
    )
  })
})

describe('raw-color ratchet', () => {
  it('every src file with a raw color is allowlisted', () => {
    const unlisted = Object.entries(offenders)
      .filter(([p]) => !(p in ALLOWLIST))
      .map(([p, hits]) => `${p}: ${[...new Set(hits)].join(' ')}`)
    expect(unlisted, 'use a palette token (tailwind.config.js) instead').toEqual([])
  })

  it('every allowlisted file still has a raw color (delete converted entries)', () => {
    const stale = Object.keys(ALLOWLIST).filter((p) => !(p in offenders))
    expect(stale).toEqual([])
  })

  it('every allowlist entry has a one-line reason', () => {
    for (const [p, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.trim(), p).not.toBe('')
      expect(reason, p).not.toContain('\n')
    }
  })
})
