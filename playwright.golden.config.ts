import { defineConfig, devices } from '@playwright/test'
import { resolveLocalSupabaseEnv } from './e2e/helpers/env'
import { AUTH_STATE_PATH } from './e2e/helpers/constants'

// Golden-path E2E (Stage 4.5). Unlike the CI smoke (playwright.config.ts — dummy env, no DB),
// this suite drives the app against the REAL running local Supabase stack: a seeded session
// (storageState) signs us in, and the AI Edge Functions are mocked per-spec (no Anthropic spend).
// Local-only by design — CI stays smoke-only (ADR-0011 / ADR-0018). Resolving the keys here also
// fails fast with a clear "run supabase start" message when the stack is down.
const PORT = 5174 // distinct from the smoke server (5173) so the two never collide
const { apiUrl, anonKey } = resolveLocalSupabaseEnv()

export default defineConfig({
  testDir: './e2e/golden',
  // A shared test user + DB-backed state → run serially for determinism.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // Pin the browser's locale + timezone so specs are deterministic on any host: the Done
    // tab's timestamp format follows the locale, and running in UTC makes every timezone
    // fallback in the app (browser zone vs 'UTC') resolve to the same calendar day.
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [
    // Seeds the user + clean slate, then signs in once and saves storageState.
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'chromium',
      // Desktop specs only — `*.golden.spec.ts` matches `*.mobile.golden.spec.ts` too, so
      // ignore the mobile ones (they run in chromium-mobile at a phone viewport).
      testMatch: /\.golden\.spec\.ts$/,
      testIgnore: /\.mobile\.golden\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE_PATH },
    },
    {
      // Mobile golden specs (Stage 5): a phone viewport with touch, so `useIsMobile` flips the
      // grid to tap-to-place and the nav to the bottom bar. Same seeded session; the per-test DB
      // wipe (fixtures) keeps it independent of the desktop specs despite the shared user.
      name: 'chromium-mobile',
      testMatch: /\.mobile\.golden\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: AUTH_STATE_PATH },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // Inject the REAL local keys so the app talks to the running Supabase stack (the seeded
    // session is issued by — and only valid against — this same local stack).
    env: {
      VITE_SUPABASE_URL: apiUrl,
      VITE_SUPABASE_ANON_KEY: anonKey,
    },
  },
})
