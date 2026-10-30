import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_THEME_PREFERENCE, THEME_STORAGE_KEY } from './theme'

// Lockstep (TOD-137): public/theme-boot.js is a classic, dependency-free copy of the preference
// logic that runs before the bundle, so it cannot import src/lib/theme.ts. This test evaluates the
// real file in jsdom and pins its key, default and theme-color literals to their sources of truth
// (src/lib/theme.ts and src/index.css `--c-bg`), and pins the index.html tags that load it.
// node:fs is loaded untyped for the same reason as theme-tokens.test.ts (browser-typed project).
const fs = (await import('node:fs' as string)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}
const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const script = read('../../public/theme-boot.js')
const css = read('../index.css')
const html = read('../../index.html')

function cssBg(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(start, css.indexOf('}', start))
  const m = /--c-bg:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/.exec(body)
  if (!m) throw new Error(`no --c-bg in ${selector}`)
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`
}

function stubMatchMedia(dark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: dark && query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

function run(): void {
  new Function(script)()
}

const root = document.documentElement
let meta: HTMLMetaElement

beforeEach(() => {
  localStorage.clear()
  root.className = ''
  root.style.colorScheme = ''
  meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = 'unset'
  document.head.appendChild(meta)
})

afterEach(() => {
  meta.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('public/theme-boot.js', () => {
  it.each([
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
    ['light', true, 'light'],
    ['light', false, 'light'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
    // Garbage is the default ('system'), so it follows the OS.
    ['garbage', true, 'dark'],
    ['garbage', false, 'light'],
    ['dark foo', true, 'dark'],
  ])('stored %j with OS dark=%s → %s', (stored, osDark, expected) => {
    localStorage.setItem(THEME_STORAGE_KEY, stored)
    stubMatchMedia(osDark)
    run()
    expect(root.classList.contains('dark')).toBe(expected === 'dark')
    expect(root.style.colorScheme).toBe(expected)
    expect(meta.content).toBe(cssBg(expected === 'dark' ? 'html.dark' : ':root'))
    // The stored value never reaches the DOM — only the one class this script owns.
    expect(root.className).toBe(expected === 'dark' ? 'dark' : '')
  })

  it.each([
    [true, 'dark'],
    [false, 'light'],
  ])('no stored value → the default (system) with OS dark=%s → %s', (osDark, expected) => {
    stubMatchMedia(osDark)
    run()
    expect(root.classList.contains('dark')).toBe(expected === 'dark')
    expect(root.style.colorScheme).toBe(expected)
  })

  it('a throwing localStorage falls back to the default (system)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    stubMatchMedia(true)
    expect(run).not.toThrow()
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.colorScheme).toBe('dark')
  })

  it('a throwing matchMedia under system treats the OS as light', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => {
        throw new Error('no matchMedia')
      }),
    )
    expect(run).not.toThrow()
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.style.colorScheme).toBe('light')
  })

  it('leaves classes it does not own alone', () => {
    root.classList.add('other')
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    run()
    expect(root.className).toBe('other')
  })
})

describe('lockstep with src/lib/theme.ts and src/index.css', () => {
  it('uses the same storage key and default', () => {
    expect(/var KEY = '([^']+)'/.exec(script)?.[1]).toBe(THEME_STORAGE_KEY)
    expect(/var DEFAULT = '([^']+)'/.exec(script)?.[1]).toBe(DEFAULT_THEME_PREFERENCE)
  })

  it('its theme-color literals equal the --c-bg values', () => {
    const m = /var COLORS = \{ light: '(#[0-9a-f]{6})', dark: '(#[0-9a-f]{6})' \}/.exec(script)
    expect(m?.[1]).toBe(cssBg(':root'))
    expect(m?.[2]).toBe(cssBg('html.dark'))
  })

  it('index.html loads it as a classic head script before the module entry, with a theme-color meta', () => {
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toMatch(/<meta name="theme-color" content="[^"]+" \/>/)
    const tag = /<script[^>]*src="\/theme-boot\.js"[^>]*><\/script>/.exec(head)?.[0]
    expect(tag).toBe('<script src="/theme-boot.js"></script>')
    expect(html.indexOf(tag as string)).toBeLessThan(html.indexOf('type="module"'))
  })
})
