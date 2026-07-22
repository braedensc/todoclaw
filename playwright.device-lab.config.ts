import { defineConfig, devices, type Project } from '@playwright/test'
import { resolveLocalSupabaseEnv } from './e2e/helpers/env'
import { AUTH_STATE_PATH } from './e2e/helpers/constants'

// Device lab — "what does the mobile layout actually look like on a spread of phones?"
//
// One spec (e2e/device-lab/layout.device-lab.spec.ts) runs across a matrix of phone geometries and
// asserts the shell's hard invariant on every one — the bottom nav sits flush to the viewport
// bottom in every state (baseline, browser-chrome vs standalone heights, keyboard up over the add
// sheet and the chat composer) — while screenshotting each state. A global teardown assembles the
// shots into a single contact sheet: device-lab-report/index.html.
//
// Like the golden suite this drives the REAL app against the running local Supabase stack (run
// `supabase start` first) with the shared seeded session; unlike golden, the device tests are
// READ-ONLY after the one-time demo seed, so they parallelize safely across projects.
//
// Fidelity boundary (also in e2e/device-lab/README.md): this is Chromium DEVICE EMULATION — exact
// viewport/DPR/UA/touch per device, but not the Safari engine, and no real on-screen keyboard
// (the keyboard scenarios drive the app's real visualViewport listeners through a shim). It
// catches layout/geometry regressions across sizes before a phone ever sees them; a real device
// remains the final word on Safari/OEM-browser quirks.
const PORT = 5175 // 5173 = smoke, 5174 = golden — distinct so parallel sessions never collide
const { apiUrl, anonKey } = resolveLocalSupabaseEnv()

// The matrix: Playwright descriptor names, smallest → largest. Curated to bracket the real-world
// spread — the narrowest (320) and shortest phones we care about, the no-notch classic, compact +
// flagship iPhones, and the common Androids (Pixel 7 is also the golden mobile device).
const PHONES = [
  'Galaxy S9+', // 320×658 — narrowest
  'iPhone SE', // 375×667 @2x — classic small iPhone, no notch
  'iPhone 12 Mini', // 375×812 — compact notch
  'iPhone 14', // 390×664 browser viewport / 390×844 screen
  'Pixel 5', // 393×851
  'Pixel 7', // 412×915 — the golden suite's phone
  'iPhone 15 Pro Max', // 430×932 — largest current iPhone
] as const

const missing = PHONES.filter((name) => !(name in devices))
if (missing.length > 0) {
  throw new Error(
    `Unknown Playwright device descriptor(s): ${missing.join(', ')} — check PHONES against this @playwright/test version.`,
  )
}

const deviceProjects: Project[] = PHONES.map((name) => ({
  name,
  testMatch: /layout\.device-lab\.spec\.ts$/,
  dependencies: ['device-lab seed'],
  // browserName pins every project to Chromium even where the descriptor's default engine is
  // WebKit (iPhones): one engine keeps the matrix comparable + CDP available, and geometry —
  // what this lab asserts — is engine-agnostic. See the README's fidelity note.
  use: { ...devices[name], browserName: 'chromium' as const, storageState: AUTH_STATE_PATH },
}))

export default defineConfig({
  testDir: './e2e',
  testMatch: [/golden\/auth\.setup\.ts$/, /device-lab\/.*\.(setup|spec)\.ts$/],
  fullyParallel: false,
  // Device projects are read-only against the shared seeded user, so they may run concurrently —
  // unlike golden, which mutates per-test and must stay serial.
  workers: 3,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  globalTeardown: './e2e/device-lab/report.teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // Same determinism pins as the golden config: locale-stable strings, UTC calendar day.
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [
    // Reuse the golden auth bootstrap: creates the test user, wipes state, signs in via the real
    // form, persists storageState. Runs at desktop defaults (its landmarks are the desktop shell).
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    // Then seed the demo dataset once (screenshots of an EMPTY planner would prove very little)
    // and reset the report output dir.
    {
      name: 'device-lab seed',
      testMatch: /device-lab\/seed\.setup\.ts$/,
      dependencies: ['setup'],
    },
    ...deviceProjects,
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: apiUrl,
      VITE_SUPABASE_ANON_KEY: anonKey,
    },
  },
})
