import { defineConfig, devices } from '@playwright/test'

// E2E smoke (Stage 2 PR #5). We run a fast, chromium-only smoke against the Vite dev server
// with dummy Supabase env — the app boots and shows the sign-in form when logged out, which
// needs no database. Full DB-backed E2E (auth → RLS → render) is a LOCAL workflow against the
// running Supabase stack; it is deliberately kept out of CI for cost/reliability (see ADR-0011).
const PORT = 5173

export default defineConfig({
  testDir: './e2e',
  // The DB-backed golden suite (e2e/golden/**) is a LOCAL workflow with its own config
  // (playwright.golden.config.ts); keep it out of this smoke run so CI stays no-DB (ADR-0011).
  testIgnore: '**/golden/**',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // Dummy, NON-JWT values so the app boots without .env.local (e.g. in CI). getSession()
    // reads empty localStorage and resolves null → the sign-in form renders. Never a real key.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'e2e-dummy-anon-key',
    },
  },
})
