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

    const { dbUrl } = resolveLocalSupabaseEnv()
    await resetTestUserData(dbUrl)
    await page.goto('/')
    await use(page)
  },
})

export { expect }
