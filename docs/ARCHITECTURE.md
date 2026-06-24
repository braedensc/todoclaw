# ARCHITECTURE.md

A running decision log (ADR-style): every significant technical and design choice with the *why*, the alternatives rejected, and the date. Append-only.

> Stage 0 decisions are captured in CLAUDE.md "Key Design Decisions". ADR entries below begin in Stage 1.

---

## ADR-0001 — Frontend toolchain: Vite + React 18 + TypeScript (strict) + Tailwind 3

**Date:** 2026-06-23 · **Stage:** 1 (PR #1)

The walking-skeleton toolchain. Resolved versions: Vite 8, `@vitejs/plugin-react` 6,
React 18.3, TypeScript 6, Tailwind 3.4, TanStack Query 5, `@supabase/supabase-js` 2, Zod 4.

- **React pinned to 18, not 19.** The master plan specifies React 18; staying on it avoids
  churn from React 19's breaking changes until the feature set is stable. Revisit post-parity.
- **Tailwind pinned to v3, not v4.** v4's CSS-first config (`@import "tailwindcss"`,
  `@tailwindcss/postcss`) is a different setup from the v3 `tailwind.config.js` +
  `@tailwind` directives + `autoprefixer` model the plan describes. v3 is the well-trodden,
  lower-friction path for now; a v4 migration is a deliberate later task, not an accident of
  `npm install` resolving `latest`.
- **Hand-written config over `npm create vite`.** The scaffolder would clobber the Stage 0
  `package.json` (husky/secretlint) and pull in an ESLint config we're deferring to Stage 2.
  Writing the handful of config files keeps full control and matches the "explicit over
  clever" convention.
- **Rejected:** Next.js (we want a pure SPA on Vite + Supabase, no SSR/server framework);
  CRA (unmaintained).

## ADR-0002 — TypeScript project-reference layout (solution + app + node)

**Date:** 2026-06-23 · **Stage:** 1 (PR #1)

`tsconfig.json` is a solution file (`files: []`, references) pointing at `tsconfig.app.json`
(browser/`src`, `strict` + `noUncheckedIndexedAccess` + `noUnusedLocals/Parameters`) and
`tsconfig.node.json` (`vite.config.ts`, `types: ["node"]`). `npm run build` runs
`tsc -b && vite build`; `npm run typecheck` runs `tsc -b`.

- The two environments have genuinely different globals (DOM vs. Node). Splitting them is the
  canonical Vite layout and keeps the app config free of Node types.
- `@types/node` is required by `tsconfig.node.json` because Vite's own `.d.ts` references
  `Buffer`/`Request`/`WebSocket`. Without it, `tsc -b` fails — installed as a devDependency.

## ADR-0003 — Env-var strategy: anon key client-side, service-role server-only

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

## ADR-0004 — Drag/drop = raw Pointer Events (spike resolved)

**Date:** 2026-06-23 · **Stage:** 1 deferral → **resolved Stage 3 (PR #1)**

**Background (Stage 1):** the master plan calls for spiking @dnd-kit vs. raw pointer events for
the free-canvas grid. Stage 1 only proves the pipeline (toolchain → DB → auth → render), so the
spike was deferred to Stage 3 where the grid is built.

**Decision (Stage 3): use raw Pointer Events.** We built both prototypes (a throwaway
`spike.html` bake-off) and drove them in the browser — desktop pointer + emulated touch, at a
<720px viewport. Findings:

| | Raw Pointer Events | @dnd-kit/core |
|---|---|---|
| Continuous free placement | native — `(clientX-left)/width`, y-inverted | must reconstruct from `delta`; **same manual math anyway** |
| Mouse + touch + pen | one handler set (Pointer Events API) | sensor abstraction (PointerSensor/TouchSensor) |
| Mobile tap-to-place | trivial (select → tap surface) | not native; bespoke |
| Tray→grid / popup drag-out (cross-container) | same handler, no extra wiring | needs droppable registration |
| Testability | drove it deterministically with synthetic events (drag → `0.200/0.800`, tap → `0.800/0.700`) | PointerSensor did **not** respond to synthetic events — a real unit/E2E cost |
| Dependency | none | +4 packages |

@dnd-kit is excellent for sortable lists / discrete droppables, but the free-canvas model
(continuous coords, custom clustering, no snap targets) cuts against its grain — it adds an
abstraction without removing the coordinate math we'd write regardless. The chosen primitive
ships as `src/hooks/use-free-drag.ts` (with a pure, unit-tested `toNormalized` helper); the
`spike.html`/`src/spike/` scaffold and the `@dnd-kit` dependency were removed after the decision.

**Related — Realtime deferred to Stage 5.** RLS scopes every user to their own rows, so Supabase
Realtime would only help the *same* user on two devices at once; TanStack Query's
`refetchOnWindowFocus`/`refetchOnReconnect` plus **date-keyed `daily_state` queries** cover Stage
3's needs. The Stage-3 atomic merge-RPC (see the Done/history work) makes adding Realtime later
purely additive — no write-path rework — so there is no cost to waiting.

## ADR-0005 — No client hard-delete: soft-delete + RLS deny-by-default

**Date:** 2026-06-23 · **Stage:** 1 (PR #2)

`tasks` carries `deleted_at`; the app only ever soft-deletes (an `UPDATE`). The migration
grants `authenticated` **`select, insert, update` — never `delete`** — and defines **no DELETE
policy**, so a hard delete from the client is structurally impossible (doubly: no grant *and*
no policy). RLS is deny-by-default, scoped `to authenticated`, gated on `user_id = auth.uid()`
for both `USING` and `WITH CHECK`, so a client can neither read others' rows nor forge
ownership.

- **Why:** directly serves the "no accidental data loss / no escalation" requirement. Recovery
  doesn't depend on backups for the common case — deleted data is still a live row.
- The service-role key bypasses RLS for admin/backup needs but is never used by app code.
- Verified with a psql two-user proof and a supabase-js e2e (isolation, escalation blocked,
  hard-delete denied, soft-delete recoverable).

## ADR-0006 — Production topology + encrypted backups

**Date:** 2026-06-23 · **Stage:** 1 (PR #3)

- **One cloud Supabase project = prod; local Docker = dev.** No staging project (keeps cost at
  zero); the local stack is the safe place to break things. The Claude Code hook blocks
  destructive ops against remote DBs, so the single prod project is protected from a
  fat-fingered reset.
- **Security headers/CSP** ship via `vercel.json` (HSTS, `X-Frame-Options: DENY`, nosniff,
  CSP limiting `connect-src` to self + `*.supabase.co`). Auth hardening lives in the Supabase
  dashboard (human-only toggles), documented in SERVICES.md.
- **Backups: daily encrypted `pg_dump` of the `public` schema → GitHub Actions artifact**
  (90-day retention). Authenticated by a dedicated least-privilege **`backup_ro`** role
  (SELECT on `public` only — not service-role). GitHub artifacts were chosen over R2/B2 for
  zero extra setup to prove the pipeline; the upload step is the only thing to swap if we later
  want longer retention / off-platform durability. The dump → encrypt → decrypt → restore
  round-trip is proven locally before ship.
- **One-time `db push`** seeds the cloud schema (a documented bootstrap exception); CI-driven
  migrations on merge are a Stage 2/6 task.

**Update (2026-06-23) — backup auth reality.** The least-privilege `backup_ro` plan didn't
survive contact with Supabase's managed pooler: the **free pooler (Supavisor) only accepts the
built-in `postgres` user**, not custom roles, and the **direct connection is IPv6-only** (GitHub
Actions runners are IPv4-only → "Network unreachable"). So the daily backup authenticates as
`postgres` via the **session pooler** (`aws-1-us-west-2…`, port 5432, `sslmode=require`), with
the dump still scoped to `--schema=public`. Tradeoff accepted: the backup secret holds the main
DB credential (rotate if exposed). `backup_ro` is created and reserved for restoring strict
least-privilege once we add the Supabase **IPv4 add-on** or a **self-hosted runner**. Backup →
encrypt → upload verified working in prod (encrypted artifact produced).

## ADR-0007 — Stage 2 schema: habits, daily_state, user_schedule (+ RLS, shared Zod types)

**Date:** 2026-06-23 · **Stage:** 2 (PR #1)

The remaining tables from the master-plan schema, each **replicating the proven `tasks`
pattern** (ADR-0005): RLS enabled; the only policies are owner-scoped (`user_id = auth.uid()`
in `USING` + `WITH CHECK`) and only for `authenticated`; `user_id` defaults to `auth.uid()`;
`grant select, insert, update` only — **no DELETE grant or policy**. Three migrations, one per
table, in PR #1.

- **`habits`** — soft-delete (`deleted_at`) like `tasks`; `subtasks` is an **embedded ordered
  jsonb array** of `{id,text}`, not a child table. Subtasks have no independent identity, are
  always loaded with the habit, and EisenClaw stored them inline — a jsonb array keeps that
  1:1 fidelity without a join. Index `(user_id) where deleted_at is null`.
- **`daily_state`** — **one row per `(user_id, date)`** (PK), not a single mutable
  current-state row. This makes the daily reset **non-destructive by construction**: "today" is
  just the row for today's date; yesterday's row persists. There is deliberately **no
  `lastReset` column** — the row's existence is the reset signal, so the stale-comparison race
  the original had (EISENCLAW-LOGIC-TO-PORT.md §10) cannot recur. `date` is the user's **local**
  calendar day (never `current_date`, which is server-UTC) — computed via the helper below;
  no DB default, to force a timezone-correct value. Columns `done`/`done_at`/`habit_done`/
  `subtask_done` are jsonb maps; `subtask_done` is keyed by the composite `"habitId:subtaskId"`.
  No soft-delete (the rows *are* the historical record).
- **`user_schedule`** — one row per user (PK `user_id`). **`timezone` is hoisted to a top-level
  `text not null default 'UTC'` column** (with a `length(btrim(...)) > 0` CHECK) because it is
  load-bearing for the timezone-correct daily reset and deserves a NOT NULL guarantee + cheap
  read — not a jsonb extract. The rest (`location`/`weekday`/`weekend`/`running`, the Plan My
  Day context) stays in `config` jsonb. This **deviates from the master plan's `config`-only
  shape** for that correctness reason. An `updated_at` trigger (`public.set_updated_at()`,
  reusable) keeps the row's mtime fresh.

**Shared Zod types (the "Zod = TS type" deliverable).** `src/types/{habit,daily-state,
user-schedule}.ts` mirror each table and double as parse guards at the Supabase boundary.
`tasks.bucket` tightened to `z.literal('oneoff').nullable()` (only `oneoff` exists —
Discrepancy #8; nullable because Stage 1 rows carry no bucket). `tasks.recurring` and
`user_schedule.config` are **left loose** — tightening a shape no code produces yet is
dead-spec risk; they are modeled by the stages that consume them (recurring → Stage 3,
config → the AI stage).

**Deliberately deferred (additive, no dead code now):**
- The permanent **`history` table** (denormalized Done-tab log with conditional restore) →
  **Stage 3**, with the Done feature. The master schema lists no history table; it is purely
  additive.
- Per-table **TanStack hooks** (`useHabits`/`useDailyState`/`useUserSchedule`) → **Stage 3**,
  when UI consumes them. Building them now would be untested-by-UI dead code.
- Default **`user_schedule` row** creation → **app-side upsert on first authenticated load**
  (the `use-tasks` insert pattern: client omits `user_id`, the DB default + RLS assign it),
  **not** a trigger on `auth.users`. A `SECURITY DEFINER` trigger that errors inside the signup
  transaction breaks signup entirely with an opaque error — a documented Supabase footgun.

**Timezone helper.** `src/lib/dates.ts` `localDateInTZ(timeZone, instant?)` → `YYYY-MM-DD` via
`Intl.DateTimeFormat(...).formatToParts` (locale-deterministic). This is the canonical "today
in the user's timezone" used to pick the `daily_state.date` row, directly retiring Discrepancy
#3. Seed-tested in PR #2.

**Note — platform-default grants.** Supabase's `postgres`-role default privileges
(`pg_default_acl`) auto-grant `TRUNCATE, REFERENCES, TRIGGER` to `anon`/`authenticated` on every
new `public` table. These appear on the new tables exactly as they already do on the
reviewed `tasks` table, and are **not reachable through PostgREST** (no TRUNCATE endpoint; the
roles are NOLOGIN). Left as-is for consistency with the shipped baseline; a uniform
`revoke TRUNCATE/REFERENCES/TRIGGER` across all app tables is a possible future hardening, not
a per-table divergence snuck in here.

**Verified.** `supabase db reset` applies all three cleanly; a two-user JWT proof (one
rolled-back transaction simulating two `authenticated` sessions) confirmed for every new table:
cross-user reads/writes blocked, `WITH CHECK` blocks forging `user_id`, hard `DELETE` is
permission-denied, `habits` soft-delete is recoverable, `daily_state` `(user_id,date)` isolation
holds with no PK clash across users, and the blank-`timezone` CHECK fires.

## ADR-0008 — Dev tooling: ESLint (flat) + Prettier + Vitest + React Testing Library

**Date:** 2026-06-23 · **Stage:** 2 (PR #2)

The lint/format tooling deferred from Stage 1 (ADR-0001) plus the unit/component test
harness, in one cohesive PR (so we don't lint code in one PR and re-touch it for tests in
the next). CI jobs + branch protection that *enforce* these are a separate PR (#4).

- **ESLint** — flat config (ESLint 10) in `eslint.config.js`: `@eslint/js` recommended +
  `typescript-eslint` recommended + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh`,
  with `eslint-config-prettier` **last** so Prettier owns all formatting. Chose the
  **non-type-aware** `recommended` (not `recommendedTypeChecked`) for speed and to avoid the
  "file not in project" friction the project-reference layout creates; type-checked rules are a
  deliberate later toggle, not a Stage 2 dependency. `no-unused-vars` is configured to honor the
  `_`-prefix convention (matching `tsconfig`'s `noUnusedParameters`).
- **Prettier** — `.prettierrc` (`semi: false`, `singleQuote`, `trailingComma: all`,
  `printWidth: 100`) matches the hand-written Stage 1 style, so adoption churned only a few
  lines. **Markdown is in `.prettierignore`** — docs/ADRs/READMEs are hand-formatted (tables,
  wrapping) and Prettier's markdown reflow would be pure noise.
- **Vitest + RTL** — `vitest.config.ts` (jsdom; `globals: false`, so test APIs are imported
  explicitly from `vitest` and strict TS needs **no** ambient `vitest/globals` types).
  `src/test/setup.ts` registers jest-dom via `@testing-library/jest-dom/vitest` (which also
  augments `expect`'s types) and runs RTL `cleanup()` after each test.
- **Two traps handled** (per the planning critique):
  - *`tsc -b` sees test files* (they live under `src/`). Explicit `vitest` imports + the
    jest-dom/vitest augmentation mean no `tsconfig` `types` surgery; `vitest.config.ts` is added
    to `tsconfig.node.json`'s `include` so it's typechecked node-side.
  - *`src/lib/supabase.ts` throws on missing env at import.* Component tests `vi.mock` the data
    hooks (`./use-tasks`) so no client/env is needed. A future env-based test must use a
    **non-JWT** dummy anon key — the Claude Code `PreToolUse` hook blocks writing `eyJ…` values
    into files.
- **Pre-commit** — `lint-staged` appended to `.husky/pre-commit` *after* the secretlint block,
  preserving the Node-PATH shim: `eslint --fix` + `prettier --write` on staged `ts/tsx`. Still
  layer 2 (bypassable); CI (PR #4) is the real gate.
- **Seed tests** — `localDateInTZ` (timezone + DST + invalid-zone), Zod round-trips for all four
  schemas (incl. the `bucket` literal and the blank-`timezone` rejection), and a `TaskList`
  render smoke test. `npm run lint`/`typecheck`/`test`/`format:check` all green locally.

## ADR-0009 — Observability: Sentry (dev mode) + React error boundaries + Sentry MCP

**Date:** 2026-06-23 · **Stage:** 2 (PR #3)

- **Sentry SDK — "dev mode".** `@sentry/react` is initialized in `src/main.tsx` **only when
  `VITE_SENTRY_DSN` is set** (`environment: import.meta.env.MODE`). With no DSN it is a no-op, so
  DSN-less devs, CI, and tests never send events. The DSN is a **public ingest URL, not a
  secret** (matches none of the hook's secret patterns); it's typed optional in
  `src/vite-env.d.ts`, documented in `.env.example`, and the real value lives in `.env.local`
  (Braeden adds it — the `PreToolUse` hook blocks Claude from writing `.env*`). Full production
  Sentry — live DSN, source maps, release/alert config — is **Stage 6**.
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

## ADR-0010 — CI quality gate + branch protection (the merge-then-require ordering)

**Date:** 2026-06-23 · **Stage:** 2 (PR #4)

`ci.yml` gains three jobs beside the Stage 1 secret/path gate — **Lint** (ESLint + Prettier
check), **Typecheck** (`tsc -b`), **Test** (Vitest) — all Node 22 / `npm ci`, running in
parallel on every push to `main` and every PR. This makes lint/types/tests the **unbypassable**
gate (layer 3); the pre-commit hook (layer 2) is the fast local mirror.

- **A job's `name:` IS its required-status-check context.** So the contexts are exactly
  `Lint` / `Typecheck` / `Test` / `Secret scan + forbidden paths`.
- **Merge the jobs, THEN require them — never in one motion.** GitHub will accept a required
  context that has never reported, but the instant you do, **every open PR is blocked**
  ("Expected — waiting for status to report") until that exact context reports on its head SHA.
  With the Stage 2 PRs stacked and open, flipping protection before the jobs exist on those
  branches would wedge them all. So: this PR only *adds* the jobs; the branch-protection update
  (`POST …/required_status_checks/contexts`, which adds without dropping the existing context) is
  a separate admin step run **after this PR merges to `main`** and the jobs have reported there.
  Command + rationale live in SERVICES.md.
- **`strict: true` tradeoff.** Required "branch up to date" means more rebasing now that there
  are four checks; acceptable for a 1–2 person repo, revisit if it becomes friction.
- **E2E stays out of this gate** — the Playwright smoke job (PR #5) lands non-required first so
  flakiness can't wedge `main`; promote it to required only once proven stable.

## ADR-0011 — E2E: Playwright smoke in CI; full DB-backed E2E stays local

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

## ADR-0012 — `history` table: denormalized snapshot + append-only (reconciled with soft-delete)

**Date:** 2026-06-24 · **Stage:** 3 (PR6)

The Done tab is backed by a dedicated `public.history` table — the permanent completion log —
**not** a view over `tasks`/`daily_state`. Three coupled decisions:

- **Denormalized snapshot.** Each row carries its own `text` and `bucket`, captured at
  completion time, and a `task_id` that is **nullable with NO foreign key**. The snapshot is
  the source of truth. This is the deliberate reconciliation with ADR-0005's soft-delete-only
  model: deleting a completed task from the Done tab **soft-deletes the task** (`useSoftDeleteTask`)
  while the history row survives intact. A FK + `on delete cascade` would have erased history on
  delete; a FK without cascade would have blocked it. No FK at all means the log is independent
  of the task's lifecycle — exactly what a permanent record needs.
- **Append-only / immutable.** The grant is **SELECT + INSERT only** — no UPDATE, no DELETE, and
  no update/delete RLS policy. Once a completion is written it cannot be mutated or removed by the
  app. "Restore" does not delete a history row (it only flips today's `daily_state.done`); "delete
  from the Done tab" targets the task, never the row. So there is no client path that rewrites the
  log. (This is a behaviour change from EisenClaw, whose `×` removed the entry from history — we
  keep the permanent record instead and re-point `×` at the task.)
- **`task_id` retained for restore-eligibility only.** Restore is offered (`canRestore`) only while
  the completion is still in **today's** `daily_state.done` map — checked by `task_id`. A row from
  a previous day, or whose task is gone, simply shows no Restore button. RLS owner-scopes the table
  (`user_id = auth.uid()`); the index `(user_id, completed_at desc)` serves the newest-first read.

## ADR-0013 — Keep `daily_state` jsonb maps; write them via atomic `SECURITY INVOKER` merge RPCs

**Date:** 2026-06-24 · **Stage:** 3 (PR6)

`daily_state` keeps its four jsonb maps (`done`/`done_at`/`habit_done`/`subtask_done`) on **one
row per (user, local day)** rather than normalizing completions into child rows. Writes go through
three plpgsql RPCs (`set_task_done`, `set_task_undone`, `set_daily_flag`) added in the same
migration.

- **Why keep the jsonb maps (don't normalize).** A normalized `daily_completion(user_id, date,
  kind, key, value)` table would trade the clobber problem for a join + per-toggle row churn and a
  second table to RLS, with no payoff: the maps are only ever read whole (the Done tab + habits
  read "what's checked today"), never queried by key across days. One row per day stays the simplest
  shape that matches the access pattern, and the non-destructive date-keyed reset (ADR-0007) already
  depends on it.
- **Why RPCs instead of client read-modify-write (the real fix).** With the maps on one shared row,
  a client that reads the row, edits a map in JS, and writes it back **races** any concurrent write
  to the same row — task-done racing a habit-check clobbers the other's edit (the jsonb-clobber
  hazard flagged in validation). The RPC does the merge server-side as
  `<map> = <map> || jsonb_build_object(key, val)` inside the `UPDATE`, so the merge is against the
  **current** row value under the row lock the `UPDATE` takes. Concurrent toggles to different keys
  both survive. `set_task_done` additionally folds the `history` INSERT into the **same
  transaction**, so there is never a done-without-history window. `.rpc()` is still the Supabase
  query builder, not raw SQL; plpgsql-in-migration is already precedent (`set_updated_at`).
- **Why `SECURITY INVOKER` (not DEFINER).** The functions run as the **caller**, so RLS still
  applies and `auth.uid()` is the real signed-in user. `user_id` is `auth.uid()` everywhere inside
  the function and is **never a parameter** — a caller cannot address another user's row. A
  `SECURITY DEFINER` function would run as the owner and bypass RLS; we explicitly do not want that.
  `search_path` is pinned to `public` as defence-in-depth. `set_daily_flag` whitelists its target
  map to `habit_done`/`subtask_done`, so the habits PR (PR9) reuses it with **no new migration**.
- **Realtime deferral (recorded here).** Realtime is deferred to Stage 5 (ADR/PR1 rationale: RLS
  scopes each user to their own rows, so Realtime only helps same-user-multi-device). The merge-RPC
  design makes adding it later purely additive — server-side atomic merges mean a future Realtime
  push reflects a consistent row, with no client-merge reconciliation to retrofit.
