/// <reference types="vite/client" />

// Injected by vite.config.ts `define` from Vercel's VERCEL_GIT_COMMIT_SHA at build time.
// Empty string when not built on Vercel (local dev / CI) — main.tsx maps that to "no release".
declare const __GIT_COMMIT_SHA__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  // Optional: Sentry error reporting. When unset, Sentry is not initialized (dev-mode gate).
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
