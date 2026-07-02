import { test as base, expect } from '@playwright/test'
import { resolveLocalSupabaseEnv } from './env'
import { resetTestUserData } from './db'

// Shared golden-spec test object. Every golden spec imports { test, expect } from here: the
// overridden `page` fixture wipes the test user's rows and lands on the signed-in app before
// each test, so specs start from an identical clean slate without repeating the recipe.
// (The auth setup project deliberately uses @playwright/test directly — it runs pre-session.)
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    // The whole suite shares ONE test user, so cross-file parallelism would let specs wipe
    // each other's rows mid-test. The config pins workers: 1; fail loudly if a CLI override
    // (e.g. --workers=4) breaks that invariant instead of letting specs corrupt each other.
    if (testInfo.config.workers !== 1) {
      throw new Error(
        `The golden suite shares one test user and must run serially — got workers=${testInfo.config.workers}. Re-run without a --workers override.`,
      )
    }

    // daily_state rows are keyed by the calendar day (the browser is pinned to UTC in the
    // golden config). A test that STRADDLES UTC midnight would write day D and read day D+1's
    // empty row — a once-in-a-blue-moon flake (UTC midnight = evening in US zones). If we're
    // inside the danger window, wait it out — and extend this test's timeout first, since the
    // wait (≤ ~91s) would otherwise blow the default 30s budget, which INCLUDES fixture setup.
    const msToUtcMidnight = 86_400_000 - (Date.now() % 86_400_000)
    if (msToUtcMidnight < 90_000) {
      testInfo.setTimeout(testInfo.timeout + msToUtcMidnight + 5_000)
      await new Promise((resolve) => setTimeout(resolve, msToUtcMidnight + 1_000))
    }

    const { dbUrl } = resolveLocalSupabaseEnv()
    await resetTestUserData(dbUrl)
    await page.goto('/')
    await use(page)
  },
})

export { expect }
