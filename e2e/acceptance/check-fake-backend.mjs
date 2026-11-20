// Proof that the acceptance build runs with NO real service (TOD-145). It is the check the
// acceptance runner's browser would make, written against Playwright directly so it can run in
// CI and locally:
//
//   npm run test:acceptance        # builds dist-acceptance/, then runs this
//
// For each scenario it loads the BUILT app from dist-acceptance/ the way the runner does (the
// app's own origin answered from the folder, no server process), installs the fake backend, and
// aborts and lists anything else. It then walks the screens and asserts:
//   - the home grid, the list, the habits panel, the settings (schedule) panel and the sign-in
//     screen each render what their scenario's fixtures name;
//   - every request the app made was answered by the app's own origin or by the fake backend, and
//     the fake backend had to guess at none (`unknown` is empty);
//   - nothing else was requested at all: no request reached, or tried to reach, a real service.
//
// THIS FILE IS A GRADER PATH (delivery.json `stack.graderPaths` and `autonomy.riskPaths`).
import { chromium } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as fake from './fake-backend.mjs'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const DIST = join(ROOT, 'dist-acceptance')
const ORIGIN = 'http://127.0.0.1:9' // delivery.json acceptance.serve.origin
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}
const isFile = (p) => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

const failures = []
const fail = (msg) => failures.push(msg)

/** One browser context the way the runner makes it. Returns the page and what it saw. */
async function open(browser, scenario, viewport, viewportName) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
  const seen = { app: 0, fake: 0, aborted: [] }
  await context.route(
    (url) => url.origin === ORIGIN,
    (route) => {
      seen.app += 1
      const pathname = new URL(route.request().url()).pathname
      let file = join(DIST, pathname)
      if (!file.startsWith(DIST) || !isFile(file)) file = join(DIST, 'index.html')
      route.fulfill({
        status: 200,
        contentType: TYPES[extname(file)] || 'application/octet-stream',
        body: readFileSync(file),
      })
    },
  )
  const log = await fake.install(context, {
    scenario,
    origin: ORIGIN,
    viewport: viewportName,
    mode: 'default',
  })
  // Playwright runs the LAST-registered matching route first, so this one sees every request
  // before the fake's route does. The predicate therefore leaves out the two origins that are
  // answered (the app's own and the fake's): a second origin the fake answered would need adding.
  await context.route(
    (url) => url.origin !== ORIGIN && url.origin !== fake.SUPA,
    (route) => {
      seen.aborted.push(route.request().url())
      route.abort()
    },
  )
  context.on('request', (req) => {
    if (new URL(req.url()).origin === fake.SUPA) seen.fake += 1
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  await page.goto(`${ORIGIN}/`)
  return { context, page, seen, log, errors }
}

async function expectVisible(page, label, locator) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: 10_000 })
    console.log(`  ok   ${label}`)
  } catch {
    fail(`${label}: not visible`)
    console.log(`  FAIL ${label}`)
  }
}

async function scenarioRun(browser, scenario, viewport, body) {
  console.log(`${scenario} (${viewport.width}x${viewport.height})`)
  const run = await open(browser, scenario, viewport, viewport.width < 600 ? 'phone' : 'desktop')
  try {
    await body(run.page)
    await run.page.waitForTimeout(500) // let late requests land before they are counted
  } finally {
    const { seen, log, errors } = run
    if (log.unknown.length)
      fail(`${scenario}: the fake backend had to guess at: ${[...new Set(log.unknown)].join(', ')}`)
    if (seen.aborted.length)
      fail(
        `${scenario}: requests to something real were aborted: ${[...new Set(seen.aborted)].join(', ')}`,
      )
    if (errors.length) fail(`${scenario}: the page threw: ${errors[0]}`)
    console.log(
      `  requests: ${seen.app} to the app's own origin, ${seen.fake} answered by the fake, ${log.unknown.length} unknown, ${seen.aborted.length} aborted`,
    )
    await run.context.close()
  }
}

const browser = await chromium.launch()
try {
  const desktop = { width: 1280, height: 800 }
  const phone = { width: 390, height: 844 }

  await scenarioRun(browser, 'signed-out', desktop, async (page) => {
    await expectVisible(page, 'the sign-in screen', page.getByRole('heading', { name: 'Sign in' }))
    await expectVisible(page, 'the email field', page.getByPlaceholder('you@example.com'))
  })

  await scenarioRun(browser, 'signed-in', desktop, async (page) => {
    // Home grid: the quadrants and a task the fixtures name.
    await expectVisible(
      page,
      'home: the TodoClaw heading',
      page.getByRole('heading', { name: 'TodoClaw' }),
    )
    await expectVisible(page, 'home grid: a quadrant', page.getByText(/^do now$/i))
    await expectVisible(
      page,
      'home grid: a fixture task',
      page.getByText('Call the plumber about the leak').last(),
    )
    // The morning plan the fixtures carry (schedule of the day).
    await expectVisible(
      page,
      'home: the day plan',
      page.getByText('A focused day: report first, errands after lunch.'),
    )
    // List view: a task that sits in the list, from the toggle beside the grid.
    await page.getByRole('button', { name: /List/ }).first().click()
    await expectVisible(page, 'list: a fixture task', page.getByText('Reorganize the bookshelf'))
    // Habits panel.
    await page
      .getByRole('button', { name: /Daily habits/ })
      .first()
      .click()
    await expectVisible(
      page,
      'habits: a fixture habit',
      page.getByRole('dialog').getByText('Morning stretch'),
    )
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /✕|Close/ })
      .first()
      .click()
    // Settings, where the user's schedule (location, timezone, hours, commitments) lives.
    await page
      .getByRole('button', { name: /Settings/ })
      .first()
      .click()
    await expectVisible(
      page,
      'settings: the schedule tab',
      page.getByRole('dialog').getByRole('tab', { name: 'Plan My Day' }),
    )
    await expectVisible(
      page,
      'settings: the saved location',
      page.getByRole('dialog').getByText('Portland, Oregon, United States'),
    )
  })

  await scenarioRun(browser, 'signed-in', phone, async (page) => {
    await expectVisible(
      page,
      'phone home: the quadrant overview',
      page.getByRole('region', { name: 'Quadrant overview' }),
    )
  })

  await scenarioRun(browser, 'empty', desktop, async (page) => {
    await expectVisible(
      page,
      'empty: the home screen with no tasks',
      page.getByRole('heading', { name: 'TodoClaw' }),
    )
    // A request for rows the empty account has none of must be answered, not left hanging.
    const status = await page.evaluate(
      async (base) => (await fetch(`${base}/rest/v1/chat_messages?session_id=eq.none`)).status,
      fake.SUPA,
    )
    if (status !== 200) fail(`empty: chat_messages answered ${status}, not 200`)
    if (await page.getByText('Call the plumber about the leak').count()) {
      fail('empty: a fixture task of the signed-in scenario is on screen')
    }
  })
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`\nFAIL: ${failures.length} problem(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nOK: every screen renders from the fake backend and nothing reached a real service')
