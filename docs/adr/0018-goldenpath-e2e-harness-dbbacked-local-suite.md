# ADR-0018 — Golden-path E2E harness: DB-backed local suite, mocked AI, CI stays smoke-only

**Date:** 2026-06-25 · **Stage:** 4.5 (PR1) · **Status:** Accepted

Stage 4.5 stands up a **golden-path** Playwright suite — a real regression net before Stage 5's
restyle — that drives the app against the **running local Supabase stack** (auth → RLS → render
→ real pointer drag). ADR-0011 stands: **CI stays smoke-only**; this DB-backed suite is a
**local** pre-merge/pre-release gate (Braeden's call, 2026-06-25). Decisions:

- **Two configs, never entangled.** `playwright.config.ts` is unchanged — the chromium **smoke**
  (dummy env, no DB) that CI runs — now with `testIgnore: '**/golden/**'` so it can't pick up the
  DB-backed specs. `playwright.golden.config.ts` is the new suite: `testDir: e2e/golden`,
  `workers: 1` + `fullyParallel: false` (a shared test user + DB-backed state → serialize for
  determinism), its own dev server on port **5174** (the smoke's is 5173, so they never collide).
- **Real local keys, resolved at config load.** The golden config shells out to
  `supabase status -o env` (`e2e/helpers/env.ts`) for `API_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY`
  / `DB_URL`, injects the URL+anon key into `webServer.env` so the dev server talks to the live
  stack, and **fails fast** with a "run `supabase start`" message if the stack is down — it never
  falls back to a remote or dummy DB (local-only is the invariant).
- **Auth seeding without a sign-up UI.** The app is sign-in-only (ADR-0014), so the fixed test
  user (`e2e@todoclaw.test`) is created out-of-band via the **admin API**
  (`POST /auth/v1/admin/users`, service_role key, `email_confirm: true`; idempotent — "already
  registered" is success). The session is persisted by a Playwright **setup project**
  (`e2e/golden/auth.setup.ts`, the official auth recipe — chosen over a bare `globalSetup` so the
  dev server is guaranteed up): it drives the **real sign-in form** and saves `storageState`
  (`e2e/.auth/state.json`, gitignored). Driving the real form captures whatever localStorage key
  supabase-js uses — no hand-rolled token JSON. Golden specs depend on `['setup']` and load that
  state.
- **Deterministic reset as the Postgres superuser.** `resetTestUserData` (`e2e/helpers/db.ts`)
  connects via `DB_URL` and `DELETE`s the test user's rows across `tasks` / `habits` /
  `daily_state` / `user_schedule` / `history` before each spec. The superuser bypasses RLS **and**
  the `history` append-only grant (SELECT+INSERT only — ADR-0012), which service_role over
  PostgREST can't; the user row is left intact so the session stays valid. `pg` is a devDependency.
- **AI Edge Functions are always mocked (no Anthropic spend).** Golden specs intercept
  `**/functions/v1/{plan-my-day,ai-status,ai-chat}` via `page.route` and return canned responses
  (for chat, a canned SSE stream incl. the tool-confirmation round-trip). Zero real model calls,
  fully deterministic, no key needed. (Mocks land with the AI specs in PR4.)
- **Restyle-proof selectors.** Specs use roles / text / labels / existing `data-testid`s. Where a
  semantic handle was missing, a minimal durable `data-*` hook is added — first up, `data-quadrant`
  on `GridCard` (computed from x/y) so the marquee spec asserts placement without reading pixel
  styles.

**Verified:** smoke still passes and now runs only `smoke.spec.ts`; the golden suite is green
(setup seeds + signs in; the marquee spec adds a task, drags tray→grid with real `page.mouse`,
and asserts `data-quadrant="do-now"`), and a second run is green too (idempotent seed + reset).

**Trade / deferred.** A Supabase-in-CI job (manual-dispatch or required) is **not** added — revisit
only if the local net proves insufficient (ADR-0011). Mobile **tap-to-place** specs land with the
Stage 5 responsive work; multi-user RLS E2E is out of golden-path scope.
