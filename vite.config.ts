import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vercel exposes the deploying commit as VERCEL_GIT_COMMIT_SHA at build time; bake it in as a
  // compile-time constant so Sentry can tag each error with the release that shipped it. Empty
  // string locally / in CI (the var is absent) → main.tsx treats that as "no release". Default to
  // '' rather than undefined: JSON.stringify(undefined) emits the bare token `undefined`, which
  // Vite's define handles specially — '' is safe and collapses to undefined at runtime.
  define: {
    __GIT_COMMIT_SHA__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ''),
    // Vercel sets VERCEL_ENV to 'production' | 'preview' | 'development'. Baked in so Sentry can
    // tag the environment correctly — otherwise import.meta.env.MODE is 'production' for BOTH
    // preview and prod builds (both run `vite build`), and preview errors would masquerade as prod.
    __VERCEL_ENV__: JSON.stringify(process.env.VERCEL_ENV ?? ''),
  },
})
