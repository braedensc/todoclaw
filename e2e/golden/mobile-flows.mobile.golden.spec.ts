import { test, expect } from '../helpers/fixtures'
import { openDone } from '../helpers/ui'
import type { Locator, Page } from '@playwright/test'

// Mobile golden path (ADR-0028). Runs in the `chromium-mobile` project (Pixel 7 viewport + touch),
// so `useIsMobile` (< 720px) is true. On mobile there is NO grid and NO Grid/List toggle:
// MobileMatrix (the quadrant overview→focus list) is the only task surface, and ADDING happens via
// the bottom nav's "+" → MobileAddSheet — a manual-only text + quadrant form (AI capture lives in
// the Chat tab), which drops a PLACED task at the chosen quadrant's center. The per-test DB wipe
// (fixtures) keeps these independent.
//
// NOTE: rewritten from the retired tap-to-place flow when the mobile grid was removed. Run the full
// golden suite locally to confirm selectors before merge.

// Body scroll-lock probe (string-expression form: this tsconfig has no DOM lib, so a lambda
// touching `document` would not typecheck).
const bodyOverflow = (page: Page) => page.evaluate<string>('document.body.style.overflow')

// Swipe a sheet's grab handle down far enough to dismiss (> the 120px distance threshold). Every
// mobile sheet drops its ✕ in favour of this gesture (a scrim tap / Back also dismiss). The panel
// follows the finger, but the hook measures the drag from the fixed pointer-down Y, so absolute
// mouse coordinates are correct. page.mouse dispatches the pointerdown/move/up the hook listens for.
//
// Sheets slide in over 280ms and `toBeVisible` resolves at animation START (a translated element
// already has a non-empty box). Raw page.mouse and boundingBox() have no actionability wait, so
// acting or measuring immediately reads MID-FLIGHT coordinates — the cause of all three of this
// file's historical failures (a press landing on content below the handle; a composer measured
// hundreds of px under the viewport). Poll until the box stops moving before trusting geometry.
async function settleSheet(page: Page, target: Locator): Promise<void> {
  let box = await target.boundingBox()
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(80)
    const next = await target.boundingBox()
    if (box && next && Math.abs(next.y - box.y) < 0.5) return
    box = next
  }
}

async function swipeDownToDismiss(page: Page, handle: Locator, distance = 260): Promise<void> {
  await settleSheet(page, handle)
  const box = await handle.boundingBox()
  if (!box) throw new Error('sheet grab handle not laid out')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + distance, { steps: 12 })
  await page.mouse.up()
}

// Add a task through the bottom-nav "+" sheet (manual text + quadrant), into a given quadrant.
async function addManual(page: Page, text: string, quadrant: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Account' }).getByRole('button', { name: 'Add' }).tap()
  const sheet = page.getByRole('dialog', { name: 'Add a task' })
  await sheet.getByLabel('Task text').fill(text)
  await sheet.getByRole('button', { name: quadrant }).tap()
  await sheet.getByRole('button', { name: 'Add task' }).tap()
  await expect(sheet).toBeHidden()
}

test('the add sheet is a full-screen takeover that fits without scrolling and closes via swipe-down', async ({
  page,
}) => {
  await page.getByRole('navigation', { name: 'Account' }).getByRole('button', { name: 'Add' }).tap()
  const sheet = page.getByRole('dialog', { name: 'Add a task' })
  await expect(sheet).toBeVisible()
  await settleSheet(page, sheet)

  // Full-screen: the panel spans the whole viewport (100dvh × full width).
  const viewport = page.viewportSize()!
  const box = (await sheet.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1)
  expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1)

  // Manual-only: no AI/BabyClaw mode switcher (natural-language capture is the Chat tab).
  await expect(sheet.getByRole('group', { name: 'Add mode' })).toHaveCount(0)

  // Fits: everything is reachable with no scrolling — the sheet's scroll container has no overflow.
  // (e2e is typechecked without the DOM lib, so reach getComputedStyle via the element's document.)
  const noOverflow = () =>
    sheet.evaluate((el) => {
      const view = el.ownerDocument.defaultView!
      const scroller = [el, ...el.querySelectorAll('*')].find(
        (n) => view.getComputedStyle(n).overflowY === 'auto',
      )!
      return scroller.scrollHeight <= scroller.clientHeight
    })
  expect(await noOverflow()).toBe(true)

  // The text input is the bottom-anchored composer: it sits BELOW the quadrant picker, and the Add
  // button beside it is in-bounds at the bottom edge (thumb zone, above where the keyboard rises).
  const input = (await sheet.getByLabel('Task text').boundingBox())!
  const quadrant = (await sheet.getByRole('button', { name: 'Do Now' }).boundingBox())!
  expect(input.y).toBeGreaterThan(quadrant.y)
  const submit = await sheet.getByRole('button', { name: 'Add task' }).boundingBox()
  expect(submit!.y + submit!.height).toBeLessThanOrEqual(viewport.height)

  // A swipe-down on the grab handle dismisses (the scrim is hidden behind a full-height panel, so
  // the handle is the way out — there is no ✕ anymore).
  await expect(sheet.getByRole('button', { name: 'Close' })).toHaveCount(0)
  await swipeDownToDismiss(page, sheet.getByTestId('sheet-grabber'))
  await expect(sheet).toBeHidden()
})

test('add via the bottom-nav "+" (manual → quadrant) and the task lands in that quadrant', async ({
  page,
}) => {
  await addManual(page, 'Book the dentist', 'Do Now')

  // The Do Now overview cell now counts it; drill in and confirm it's a row.
  await page.getByRole('button', { name: /Do Now, \d+ task/ }).tap()
  await expect(page.getByRole('button', { name: /Book the dentist/ })).toBeVisible()
})

test('Daily reminders opens as a sheet OVER home (home stays mounted, body scroll locked)', async ({
  page,
}) => {
  // Enter via the route, not a specific nav control — the entry point is moving (PR #156 puts
  // Daily reminders in the More sheet); the contract under test is the PRESENTATION: any
  // navigation to #/reminders on mobile shows the sheet.
  await page.evaluate("location.hash = '#/reminders'")

  // The route is #/reminders, but the mobile PRESENTATION is a bottom sheet — home is still
  // there behind it (the quadrant overview stays mounted) instead of a page swap.
  const sheet = page.getByRole('dialog', { name: 'Daily reminders' })
  await expect(sheet).toBeVisible()
  await expect(page).toHaveURL(/#\/reminders$/)
  await expect(page.getByRole('button', { name: /Do Now, \d+ task/ })).toBeVisible()

  // Scrolling happens INSIDE the sheet; the page behind is locked while it's up.
  await expect.poll(() => bodyOverflow(page)).toBe('hidden')

  // A swipe-down on the grab handle routes through goBack — same as the browser/hardware Back
  // button: the sheet closes, the history entry pops (no #/reminders in the URL), and the page
  // unlocks. There is no ✕ on mobile anymore.
  await expect(sheet.getByRole('button', { name: 'Close reminders' })).toHaveCount(0)
  await swipeDownToDismiss(page, sheet.getByTestId('sheet-grabber'))
  await expect(sheet).toBeHidden()
  await expect(page).not.toHaveURL(/#\/reminders$/)
  await expect.poll(() => bodyOverflow(page)).not.toBe('hidden')
})

test('Done opens as a sheet OVER home (home stays mounted, body locked) and swipe-down dismisses', async ({
  page,
}) => {
  // The bottom nav's Done tab navigates the #/done route; on mobile that PRESENTS as a bottom sheet
  // over the still-mounted home (like Daily reminders), not a full-page swap.
  await openDone(page)
  const sheet = page.getByRole('dialog', { name: 'Done' })
  await expect(sheet).toBeVisible()
  await expect(page).toHaveURL(/#\/done$/)
  // Home stays mounted behind it (the quadrant overview is still there); the page is scroll-locked.
  await expect(page.getByRole('button', { name: /Do Now, \d+ task/ })).toBeAttached()
  await expect.poll(() => bodyOverflow(page)).toBe('hidden')

  // No ✕ on mobile — a swipe-down on the grab handle routes through goBack, popping the route.
  await expect(sheet.getByRole('button', { name: 'Close done' })).toHaveCount(0)
  await swipeDownToDismiss(page, sheet.getByTestId('sheet-grabber'))
  await expect(sheet).toBeHidden()
  await expect(page).not.toHaveURL(/#\/done$/)
  await expect.poll(() => bodyOverflow(page)).not.toBe('hidden')
})

test('chat opens as a near-full sheet OVER home and the scrim tap dismisses it', async ({
  page,
}) => {
  // Mobile entry point: the bottom-nav Chat tab (🐾) opens the full BabyClaw chat — the add sheet
  // is now manual-only, so natural-language capture lives here.
  await page
    .getByRole('navigation', { name: 'Account' })
    .getByRole('button', { name: 'Chat' })
    .tap()

  const chat = page.getByRole('complementary', { name: 'Chat' })
  await expect(chat).toBeVisible()

  // Home stays mounted behind the sheet, with the page scroll-locked under it.
  await expect(page.getByRole('button', { name: /Do Now, \d+ task/ })).toBeAttached()
  await expect.poll(() => bodyOverflow(page)).toBe('hidden')

  // The sheet is near-full-height (92dvh): a sliver of home + scrim shows above it. Wait out
  // the 280ms slide-up first — a boundingBox taken mid-animation reads the sheet mid-slide.
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('viewport not set')
  await expect
    .poll(async () => (await chat.boundingBox())?.y ?? Number.MAX_SAFE_INTEGER)
    .toBeLessThan(viewport.height * 0.15)
  const box = await chat.boundingBox()
  if (!box) throw new Error('chat sheet not laid out')
  expect(box.height).toBeGreaterThan(viewport.height * 0.85)

  // Tapping the sliver of scrim above the settled sheet dismisses, like every other sheet.
  await page.touchscreen.tap(viewport.width / 2, 12)
  await expect(chat).toBeHidden()
  await expect.poll(() => bodyOverflow(page)).not.toBe('hidden')
})

test('completing a task from the focus list flows through to the Done panel', async ({ page }) => {
  await addManual(page, 'Water the plants', 'Do Now')

  await page.getByRole('button', { name: /Do Now, \d+ task/ }).tap()
  const row = page.getByRole('listitem').filter({ hasText: 'Water the plants' })
  await row.getByRole('button', { name: 'Mark done', exact: true }).tap()

  // Open the Done panel from the bottom nav; the completion is listed there.
  await openDone(page)
  const doneSection = page.getByRole('region', { name: 'Done' })
  await expect(
    doneSection.getByRole('listitem').filter({ hasText: 'Water the plants' }),
  ).toBeVisible()
})
