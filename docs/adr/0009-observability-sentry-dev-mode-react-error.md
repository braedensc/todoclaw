# ADR-0009 — Observability: Sentry (dev mode) + React error boundaries + Sentry MCP

**Date:** 2026-06-23 · **Stage:** 2 (PR #3)

- **Sentry SDK — "dev mode".** `@sentry/react` is initialized in `src/main.tsx` **only when
  `VITE_SENTRY_DSN` is set** (`environment: import.meta.env.MODE`). With no DSN it is a no-op, so
  DSN-less devs, CI, and tests never send events. The DSN is a **public ingest URL, not a
  secret** (matches none of the hook's secret patterns); it's typed optional in
  `src/vite-env.d.ts`, documented in `.env.example`, and the real value lives in `.env.local`
  (Braeden adds it — the `PreToolUse` hook blocks Claude from writing `.env*`). Full production
  Sentry (live DSN, release tracking, alert rules) is **Stage 6** — see the *Update (Stage 6)*
  block below, where **source maps are decided off** (not deferred).
- **Error boundaries.** `src/components/ErrorBoundary.tsx` is a reusable class component
  (`getDerivedStateFromError` + `componentDidCatch` → `Sentry.captureException`, which no-ops
  when Sentry isn't initialized) with an accessible `role="alert"` fallback + a retry button.
  It formalizes the inline boundary EisenClaw had (LOGIC-TO-PORT §13). Wrapped at **two levels**:
  the **root** in `main.tsx` (outside `QueryClientProvider`, last-resort catch-all) and the
  **authed region** in `App.tsx` (inside the provider, so a `TaskList`/query crash can't take
  down the header/sign-out). Stage 3 feature regions (grid, list, …) wrap their own as they land.
- **Sentry MCP — user-scoped, not committed** (the approved choice). Registered via
  `claude mcp add --scope user --transport http sentry https://mcp.sentry.dev/mcp` → lives in
  `~/.claude.json`, never the repo, and authenticates by OAuth on first use (no token on disk in
  the project). Lets Claude read Sentry issues directly when triaging. The setup command is in
  SERVICES.md so it's reproducible; collaborators opt in on their own machines.
- **Verified.** A test renders a throwing child inside `ErrorBoundary` and asserts the fallback
  shows and `captureException` is called; `lint`/`typecheck`/`test`/`format:check` green.

**Update (Stage 6) — production hardening.** The "dev mode" gate is kept as-is (it's the right
default); Stage 6 turns Sentry *on in prod* and adds release tracking:

- **Live DSN via Vercel prod env**, not `.env.local` — Braeden sets `VITE_SENTRY_DSN` in the Vercel
  project's **Production** environment (still a public ingest URL, not a secret). The dev-mode gate
  is unchanged: no DSN ⇒ no-op, so previews/CI/local stay silent unless a DSN is present.
- **Release tracking + environment tagging (the code change).** `vite.config.ts` bakes two Vercel
  build vars into compile-time constants (`define`, declared in `src/vite-env.d.ts`):
  `__GIT_COMMIT_SHA__` (from `VERCEL_GIT_COMMIT_SHA`) and `__VERCEL_ENV__` (from `VERCEL_ENV`).
  `main.tsx` passes `release: todoclaw@<sha>` so every event is attributed to the exact deploy, and
  `environment: __VERCEL_ENV__ || import.meta.env.MODE` so **preview deploys tag as `preview`, not
  `production`** — without this, `import.meta.env.MODE` is `'production'` for *every* `vite build`
  (preview and prod alike), so a preview error would masquerade as a prod regression. Both empty
  off-Vercel ⇒ release omitted, environment falls back to Vite's MODE. Verified: build inlines both
  constants with **no dangling identifiers** (no runtime `ReferenceError`); the live tagged-event
  path is confirmed by the prod smoke once the DSN is set.
- **Source maps: deliberately OFF.** Uploading them needs `@sentry/vite-plugin` + a `SENTRY_AUTH_TOKEN`
  + org/project config — not worth it for a 2-person app; minified stacks + the release tag suffice.
  Revisit if triage gets painful. **Alert rules:** the default "new issue" rule is kept; Braeden
  confirms a delivery channel (email) in the dashboard. All dashboard steps live in SERVICES.md.
