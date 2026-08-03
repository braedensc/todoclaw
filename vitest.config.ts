import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Unit + component tests run under jsdom. We keep `globals: false` and import the test
// APIs explicitly from 'vitest' so TS strict mode needs no ambient `vitest/globals` types.
// jest-dom matchers + RTL cleanup are wired in src/test/setup.ts.
//
// The CI-guard scripts (scripts/check-*.mjs) also ship fixture tests, colocated as
// scripts/**/*.test.mjs. They are plain Node (fs only, no React/DOM) but run under the same jsdom
// environment as everything else — jsdom is harmless for an fs-based test and keeps the shared
// setup (jest-dom + RTL cleanup, which needs a document) working uniformly across every test file.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
})
