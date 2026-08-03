import fs from 'node:fs'
import path from 'node:path'
import { test, expect, devices, type Page } from '@playwright/test'
import { REPORT_DIR, slug } from './report-paths'

// Device-lab layout spec — runs once per phone project (playwright.device-lab.config.ts).
//
// THE invariant under test, in every scenario: the bottom nav sits flush to the layout-viewport
// bottom, and the page itself is never scrolled. That is the app's anchoring contract
// (src/index.css — locked 100dvh flex column, nav as last in-flow child;
// index.html — interactive-widget=resizes-visual so a keyboard never compresses that column).
//
// Each test screenshots the state it asserts; the teardown assembles device-lab-report/index.html
// so a human can eyeball exactly what every device gets. The on-screen keyboard scenarios drive
// the app's REAL visualViewport listeners through a shim (installed below before the app boots) —
// engine emulation has no true OSK, so this exercises the same code path one layer down.

// The e2e program compiles with lib ES2023 only (tsconfig.node.json — no DOM), so the browser
// globals the evaluate/addInitScript callbacks touch are declared structurally here, file-scoped.
// These are ambient (they emit nothing): at runtime the serialized callbacks resolve the page's
// real `window`/`document`. Kept minimal on purpose — just what this spec dereferences.
type LabListener = ((ev: unknown) => void) | { handleEvent(ev: unknown): void }
interface LabElement {
  id: string
  style: Record<string, string>
  textContent: string
  scrollHeight: number
  clientHeight: number
  scrollTop: number
  appendChild(el: LabElement): void
}
declare const window: {
  innerHeight: number
  innerWidth: number
  scrollY: number
  visualViewport: {
    height: number
    width: number
    offsetTop: number
    offsetLeft: number
    pageTop: number
    pageLeft: number
    scale: number
    addEventListener(type: string, cb: LabListener): void
    removeEventListener(type: string, cb: LabListener): void
  } | null
  __deviceLab: { simulateKeyboard(px: number): void }
}
declare const document: {
  createElement(tag: string): LabElement
  body: LabElement
  querySelectorAll(selector: string): ArrayLike<LabElement>
  scrollingElement: { scrollTop: number } | null
  documentElement: { scrollTop: number }
}

/** Per-test record consumed by report.teardown.ts. One JSON per (device, test). */
interface LabRecord {
  device: string
  viewport: { width: number; height: number }
  scenario: string
  status: string
  notes: string[]
  shots: { label: string; file: string; viewport: { width: number; height: number } }[]
}

let record: LabRecord

test.beforeEach(async ({ page }, testInfo) => {
  record = {
    device: testInfo.project.name,
    viewport: page.viewportSize() ?? { width: 0, height: 0 },
    scenario: testInfo.title,
    status: 'running',
    notes: [],
    shots: [],
  }

  // visualViewport shim + keyboard simulator, installed before any app script runs. It forwards
  // the real viewport's geometry and subtracts a simulated keyboard height, firing the same
  // 'resize' listeners the app registered — so useKeyboardViewport / useLockedViewportGuard run
  // their genuine production paths.
  await page.addInitScript(() => {
    const real = window.visualViewport
    let kb = 0
    const listeners: Record<string, Set<LabListener>> = {
      resize: new Set(),
      scroll: new Set(),
    }
    const shim = {
      get height() {
        return (real ? real.height : window.innerHeight) - kb
      },
      get width() {
        return real ? real.width : window.innerWidth
      },
      get offsetTop() {
        return real ? real.offsetTop : 0
      },
      get offsetLeft() {
        return real ? real.offsetLeft : 0
      },
      get pageTop() {
        return real ? real.pageTop : 0
      },
      get pageLeft() {
        return real ? real.pageLeft : 0
      },
      get scale() {
        return real ? real.scale : 1
      },
      addEventListener(type: string, cb: LabListener) {
        listeners[type]?.add(cb)
      },
      removeEventListener(type: string, cb: LabListener) {
        listeners[type]?.delete(cb)
      },
      dispatchEvent() {
        return true
      },
    }
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => shim })
    window.__deviceLab = {
      simulateKeyboard(px: number) {
        kb = px
        const ev = new Event('resize')
        listeners.resize?.forEach((cb) =>
          typeof cb === 'function' ? cb.call(shim, ev) : cb.handleEvent(ev),
        )
      },
    }
  })
})

// eslint-disable-next-line no-empty-pattern -- Playwright hooks require the destructured fixtures param even when unused
test.afterEach(async ({}, testInfo) => {
  record.status = testInfo.status ?? 'unknown'
  if (testInfo.status !== 'passed') {
    record.notes.push(`test ${testInfo.status}: ${testInfo.error?.message?.split('\n')[0] ?? ''}`)
  }
  const file = path.join(REPORT_DIR, `${slug(record.device)}__${slug(record.scenario)}.json`)
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(record, null, 2))
})

async function gotoHome(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Account' })).toBeVisible({ timeout: 15_000 })
}

/** Screenshot the current state into the report (css-pixel scale keeps the folder light). */
async function shoot(page: Page, label: string): Promise<void> {
  const file = `shots/${slug(record.device)}__${slug(label)}.png`
  await page.screenshot({
    path: path.join(REPORT_DIR, file),
    animations: 'disabled',
    scale: 'css',
  })
  record.shots.push({ label, file, viewport: page.viewportSize() ?? { width: 0, height: 0 } })
}

/**
 * The anchoring contract: bar flush to the viewport bottom (±1px for DPR rounding), tall enough
 * to be usable, page not scrolled in either direction.
 */
async function expectNavAnchored(page: Page, label: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Account' })
  await expect(nav, label).toBeVisible()
  const box = await nav.boundingBox()
  const vp = page.viewportSize()
  expect(box, `${label}: nav has a box`).toBeTruthy()
  expect(vp, `${label}: viewport known`).toBeTruthy()
  const gap = vp!.height - (box!.y + box!.height)
  record.notes.push(`${label}: nav bottom gap ${gap.toFixed(1)}px @ ${vp!.width}×${vp!.height}`)
  expect(
    Math.abs(gap),
    `${label}: bottom bar must sit flush to the viewport bottom`,
  ).toBeLessThanOrEqual(1)
  expect(box!.height, `${label}: bar too short to use`).toBeGreaterThanOrEqual(56)
  const scrolled = await page.evaluate(() => ({
    y: window.scrollY,
    el: (document.scrollingElement ?? document.documentElement).scrollTop,
  }))
  expect(scrolled.y, `${label}: window must not be scrolled`).toBe(0)
  expect(scrolled.el, `${label}: document must not be scrolled`).toBe(0)
}

async function simulateKeyboard(page: Page, px: number): Promise<void> {
  await page.evaluate((h) => window.__deviceLab.simulateKeyboard(h), px)
}

/** Draw a labeled stand-in where the OSK would sit, so screenshots read at a glance. */
async function showKeyboardOverlay(page: Page, px: number): Promise<void> {
  await page.evaluate((h) => {
    const el = document.createElement('div')
    el.id = '__device-lab-keyboard'
    Object.assign(el.style, {
      position: 'fixed',
      left: '0',
      right: '0',
      bottom: '0',
      height: `${h}px`,
      background:
        'repeating-linear-gradient(45deg, rgba(52,52,62,.9), rgba(52,52,62,.9) 14px, rgba(74,74,88,.9) 14px, rgba(74,74,88,.9) 28px)',
      zIndex: '2147483647',
      display: 'grid',
      placeItems: 'center',
      color: '#fff',
      font: '600 13px system-ui',
      pointerEvents: 'none',
    })
    el.textContent = `simulated keyboard — ${h}px`
    document.body.appendChild(el)
  }, px)
}

test('baseline home', async ({ page }) => {
  await gotoHome(page)

  // Canary for the anchoring fix itself: the viewport meta must keep the keyboard an overlay
  // (resizes-visual) and safe-area insets resolvable (viewport-fit=cover). If someone flips this
  // back to resizes-content, Android bars ride the keyboard again — fail loudly here.
  const meta = await page.locator('meta[name="viewport"]').getAttribute('content')
  expect(meta).toContain('interactive-widget=resizes-visual')
  expect(meta).toContain('viewport-fit=cover')

  await shoot(page, 'baseline')
  await expectNavAnchored(page, 'baseline')

  // Scrolling the CONTENT region must move content only — never the bar, never the page.
  const before = await page.getByRole('navigation', { name: 'Account' }).boundingBox()
  const scrolledSome = await page.evaluate(() => {
    // Find the app's scrollable content region by probing: setting scrollTop only sticks on a
    // genuinely scrollable element (overflow-hidden containers clamp it straight back to 0).
    for (const el of Array.from(document.querySelectorAll('#root *'))) {
      if (el.scrollHeight <= el.clientHeight + 10) continue
      el.scrollTop = 300
      if (el.scrollTop > 0) return true
    }
    return false
  })
  if (scrolledSome) {
    const after = await page.getByRole('navigation', { name: 'Account' }).boundingBox()
    expect(after!.y, 'content scroll must not move the bar').toBeCloseTo(before!.y, 0)
    await expectNavAnchored(page, 'after content scroll')
  } else {
    record.notes.push('content fits this viewport — scroll-invariance check skipped')
  }
})

test('browser chrome vs standalone height', async ({ page }, testInfo) => {
  // The descriptor viewport approximates the in-browser layout viewport (URL bar visible); the
  // descriptor's `screen` is the full display — what a standalone/PWA launch (or a retracted
  // toolbar) gives the page. The bar must track the layout-viewport bottom at BOTH heights —
  // that is precisely what 100dvh + in-flow anchoring promise.
  await gotoHome(page)
  await shoot(page, 'browser chrome')
  await expectNavAnchored(page, 'browser-chrome height')

  const descriptor = devices[testInfo.project.name] as
    | { viewport: { width: number; height: number }; screen?: { width: number; height: number } }
    | undefined
  const base = page.viewportSize()!
  const full = descriptor?.screen ?? { width: base.width, height: base.height + 80 }
  await page.setViewportSize(full)
  record.notes.push(`standalone height ${full.width}×${full.height}`)
  await shoot(page, 'standalone')
  await expectNavAnchored(page, 'standalone height')
})

test('keyboard over add sheet', async ({ page }) => {
  await gotoHome(page)
  const vp = page.viewportSize()!
  const nav = page.getByRole('navigation', { name: 'Account' })
  const navBefore = await nav.boundingBox()

  await nav.getByRole('button', { name: 'Add' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add a task' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('textbox').first().focus()

  // A portrait OSK is ~40% of the screen. With resizes-visual this shrinks ONLY the visual
  // viewport — the layout viewport (and the bar glued to its bottom) must not move at all.
  const kb = Math.round(vp.height * 0.4)
  await simulateKeyboard(page, kb)
  await showKeyboardOverlay(page, kb)
  await shoot(page, 'add sheet + keyboard')

  const navAfter = await nav.boundingBox()
  expect(navAfter!.y, 'keyboard must not move the bottom bar').toBeCloseTo(navBefore!.y, 0)
  await expectNavAnchored(page, 'keyboard up (add sheet)')
  await simulateKeyboard(page, 0)
})

test('keyboard over chat composer', async ({ page }) => {
  await gotoHome(page)
  const vp = page.viewportSize()!
  const nav = page.getByRole('navigation', { name: 'Account' })

  await nav.getByRole('button', { name: 'Chat' }).click()
  await page.getByRole('button', { name: 'Start a new chat' }).click()
  // Both chat surfaces mount their composer (desktop ChatRail sits display:none'd in #root on
  // mobile; the phone ChatPanel is portaled to body) — target the one actually on screen.
  const composer = page.getByLabel('Message').filter({ visible: true })
  await expect(composer).toBeVisible()
  await composer.focus()

  const kb = Math.round(vp.height * 0.4)
  await simulateKeyboard(page, kb)

  // The chat sheet re-fits to the visible band via useKeyboardViewport (the same production path
  // on iOS AND — post resizes-visual — Android): its composer must land above the keyboard.
  await expect
    .poll(
      async () => {
        const box = await composer.boundingBox()
        return box ? box.y + box.height : Number.POSITIVE_INFINITY
      },
      { message: 'composer must re-fit above the keyboard' },
    )
    .toBeLessThanOrEqual(vp.height - kb + 2)

  await showKeyboardOverlay(page, kb)
  await shoot(page, 'chat + keyboard')

  // And beneath the sheet, the bar itself still hasn't moved.
  await expectNavAnchored(page, 'keyboard up (chat)')
  await simulateKeyboard(page, 0)
})
