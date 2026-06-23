import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Unit + component tests run under jsdom. We keep `globals: false` and import the test
// APIs explicitly from 'vitest' so TS strict mode needs no ambient `vitest/globals` types.
// jest-dom matchers + RTL cleanup are wired in src/test/setup.ts.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
