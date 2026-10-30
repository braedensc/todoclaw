import { describe, expect, it } from 'vitest'

// The palette lives in two homes (TOD-136): tailwind.config.js names every color token as
// `c('<name>')` → `rgb(var(--c-<name>) / <alpha-value>)`, and src/index.css gives each `--c-*` an
// RGB triplet on :root (light) and html.dark (dark). Both files are read from disk so this test
// pins the real sources, not a copy of them. This project is browser-typed (no node types), and
// vitest's CSS pipeline blanks `?raw` CSS imports, so node:fs is loaded untyped at runtime.
const fs = (await import('node:fs' as string)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}
const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const css = read('../index.css')
const tailwindConfig = read('../../tailwind.config.js')

type Rgb = [number, number, number]

const tokenNames = [...tailwindConfig.matchAll(/\bc\('([a-z-]+)'\)/g)].map((m) => m[1] as string)

function block(selector: string): Map<string, Rgb> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no ${selector} block in index.css`)
  const body = css.slice(start, css.indexOf('}', start))
  const vars = new Map<string, Rgb>()
  for (const m of body.matchAll(/--c-([a-z-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    vars.set(m[1] as string, [Number(m[2]), Number(m[3]), Number(m[4])])
  }
  return vars
}

const light = block(':root')
const dark = block('html.dark')

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

function contrast(set: Map<string, Rgb>, fg: string, bg: string): number {
  const a = luminance(set.get(fg) as Rgb)
  const b = luminance(set.get(bg) as Rgb)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const SURFACES = ['bg', 'panel', 'card']
// Text-on-surface pairs plus the solid-fill pairs the `on-*` tokens exist for.
const CHECKED_PAIRS: [string, string][] = [
  ...[
    'ink',
    'muted',
    'muted-light',
    'primary',
    'accent',
    'danger',
    'puppy',
    'quadrant-do-now',
    'quadrant-schedule',
    'quadrant-errands',
    'quadrant-someday',
  ].flatMap((fg) => SURFACES.map((bg): [string, string] => [fg, bg])),
  ['on-ink', 'ink'],
  ...['primary', 'accent', 'danger', 'puppy'].map((bg): [string, string] => ['on-accent', bg]),
]

describe('theme tokens', () => {
  it('every tailwind color entry is a --c-* variable token', () => {
    const colors = tailwindConfig.slice(
      tailwindConfig.indexOf('colors: {'),
      tailwindConfig.indexOf('fontFamily'),
    )
    expect(colors).not.toMatch(/['"]#[0-9a-f]{3,8}['"]/i)
    expect(tailwindConfig).toContain("darkMode: 'class'")
    expect(tailwindConfig).toContain('`rgb(var(--c-${name}) / <alpha-value>)`')
    expect(tokenNames).toEqual(expect.arrayContaining(['on-ink', 'on-accent', 'scrim']))
  })

  it.each(tokenNames)('%s has both a :root and an html.dark value', (name) => {
    expect(light.has(name), `:root --c-${name}`).toBe(true)
    expect(dark.has(name), `html.dark --c-${name}`).toBe(true)
  })

  it('light keeps the pre-variable values it is pinned to', () => {
    expect(light.get('card')).toEqual([255, 255, 255])
    expect(light.get('ink')).toEqual([46, 42, 36])
    expect(light.get('scrim')).toEqual(light.get('ink'))
  })

  it('the scrim stays dark in dark mode', () => {
    expect(luminance(dark.get('scrim') as Rgb)).toBeLessThan(0.05)
  })

  it.each(SURFACES.flatMap((bg) => ['ink', 'muted'].map((fg) => [fg, bg])))(
    'dark %s on %s is at least 4.5:1',
    (fg, bg) => {
      expect(contrast(dark, fg as string, bg as string)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(CHECKED_PAIRS)('dark %s on %s is at least as contrasted as light', (fg, bg) => {
    expect(contrast(dark, fg, bg)).toBeGreaterThanOrEqual(contrast(light, fg, bg))
  })
})
