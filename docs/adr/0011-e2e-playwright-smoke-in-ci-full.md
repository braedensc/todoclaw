# ADR-0011 — E2E: Playwright smoke in CI; full DB-backed E2E stays local

**Date:** 2026-06-23 · **Stage:** 2 (PR #5)

Playwright is the E2E framework. The confirmed scope (with Braeden) is **smoke-only in CI**, not
full Supabase-in-CI:

- **CI smoke** — one **chromium-only** test runs against the Vite **dev server** with **dummy,
  non-JWT** Supabase env (`playwright.config.ts` `webServer.env`). With no stored session,
  `getSession()` resolves `null` and the app renders the sign-in form — so the smoke proves
  build + server + Playwright wiring **without a database**. The job installs only chromium
  (`--with-deps chromium`) to keep it fast.
- **Non-required** in branch protection initially (it runs on every PR but doesn't block merge),
  so a flaky browser run can't wedge `main`. Promote to required once it's proven stable.
- **Why not full Supabase-in-CI** — booting the Docker Supabase stack in Actions is slow, flakier,
  and burns more minutes (Braeden values low cost / reliability). **Full DB-backed E2E**
  (auth → RLS → render with two users) is documented as a **local** workflow against the running
  `supabase start` stack; revisit Supabase-in-CI (or a self-hosted runner) only if the smoke
  proves insufficient.
- **Isolation** — specs live in `e2e/*.spec.ts`, outside `src/`, so they're picked up by neither
  Vitest (`src/**/*.test.*`) nor `tsc -b` (`include: ["src"]`); Playwright transpiles them itself.
  `playwright.config.ts` is typechecked node-side (added to `tsconfig.node.json`). Artifacts
  (`test-results/`, `playwright-report/`) are gitignored. Verified: smoke passes locally.
