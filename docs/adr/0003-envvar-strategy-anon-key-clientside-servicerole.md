# ADR-0003 — Env-var strategy: anon key client-side, service-role server-only

**Date:** 2026-06-23 · **Stage:** 1 (PR #1)

Only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` reach the frontend (typed in
`src/vite-env.d.ts`). The anon key is public by design — **Row Level Security is the real
access guard**. The service-role key bypasses RLS and never appears in any frontend file,
`.env.example`, or the bundle; it is not used by app code in Stage 1 at all.

- `.env.example` (placeholders) is the only committed env file. `.env.local` (real local
  values) is gitignored.
- **Claude cannot create `.env.local`** — the `PreToolUse` hook blocks writes to `.env*`
  files and JWT-shaped values (the local anon key is a JWT). That's the security model working
  as intended; creating `.env.local` is a human/shell step (see SETUP.md).
