/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by vite.config.ts `define` from Vercel's build-time env vars. Empty strings when not
// built on Vercel (local dev / CI): __GIT_COMMIT_SHA__ → "no release", __VERCEL_ENV__ → fall back
// to Vite's MODE for the Sentry environment tag (see main.tsx).
declare const __GIT_COMMIT_SHA__: string
declare const __VERCEL_ENV__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  // Optional: Sentry error reporting. When unset, Sentry is not initialized (dev-mode gate).
  readonly VITE_SENTRY_DSN?: string
  // Optional: the owner's auth.users id (ADR-0030). Only used to SHOW the owner the "Invite
  // someone" UI — the real gate is the server-side OWNER_USER_ID check in generate-invite. Public.
  readonly VITE_OWNER_USER_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
