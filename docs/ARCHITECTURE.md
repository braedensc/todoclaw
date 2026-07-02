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

## ADR-0014 — Invite-only access (private MVP on the owner's key)

**Date:** 2026-06-24 · **Stage:** 4 (PR1)

The Stage 4 MVP is a **private, invite-only app** (Braeden + a small circle of friends/family)
running AI on Braeden's own Anthropic key. Access is closed at two layers:

- **Supabase Auth (dashboard, human-only):** public sign-up **disabled**; accounts are created
  by owner **invite-by-email**. This is the actual gate — the database simply has no path to a
  self-created account.
- **Frontend (`AuthForm.tsx`):** **sign-in-only**. The sign-up mode/toggle/`signUp` call were
  removed; the form only ever calls `signInWithPassword`. There is no account-creation affordance
  in the client at all (defense in depth + honest UX — the button can't promise what the backend
  refuses).

**Why this shape.** Because everyone who can sign in is invited and trusted, a large amount of
complexity collapses: there is **no BYOK, no per-user key resolution, and no allowlist table** —
"who is invited" is exactly "who has an account." That trust is also what lets AI run on the
**owner's key** for every signed-in user (see ADR-0015) instead of each user supplying their own.

**Deviation from the master plan, recorded deliberately.** The master plan's CLAUDE.md Hard Rule
#6 frames AI as "opt-in, off by default." For the invite-only MVP that consent gate is **dropped
for now** (Braeden's call, 2026-06-24): AI is available to every signed-in user, with cost bounded
by the owner-key guardrails (ADR-0015) rather than per-user consent. The architecture leaves room
to re-add a thin consent layer later (a boolean + a one-time notice) without reworking anything.
The planner remains **fully usable without AI** regardless.

**Deferred (NOT this stage).** A public version: the trustworthy paths are OpenRouter OAuth
(user-funded, capped, no key paste) or a paid SaaS (Stripe); raw "paste your key" BYOK is rejected
as a front door. Anthropic offers no third-party billing OAuth, so direct-Anthropic public sharing
would force raw BYOK — avoid. If/when sign-up opens, add Cloudflare Turnstile CAPTCHA on auth (not
needed while invite-only).

## ADR-0015 — Owner-key AI architecture + rate-limit/budget guardrails

**Date:** 2026-06-24 · **Stage:** 4 (PR2)

All Stage 4 AI runs on the **owner's** Anthropic key, **server-side only**, in Supabase Edge
Functions (Deno 2). This ADR records the architecture every AI feature (Plan My Day → PR3, chat
→ PR4) sits on; this PR builds the shared foundation + guardrails + a proof endpoint (`ai-status`).

**Key handling (the hard invariant).** `ANTHROPIC_API_KEY` is an Edge Function secret
(`supabase secrets set`), read via `Deno.env`. It is **never** a `VITE_*` var, never in the
bundle, never logged. The frontend calls functions through the Supabase client (which attaches
the user's JWT); the model is only ever reached server-side.

**Request path (`supabase/functions/_shared/`).** `cors.ts` locks `Access-Control-Allow-Origin`
to an `ALLOWED_ORIGIN` allow-list (never `*` — Discrepancy #7); `auth.ts` builds a Supabase
client scoped to the **caller's JWT**, so every DB call runs under RLS as the real user and
`auth.uid()` is server-derived (the model never supplies `user_id`). There is **no service-role
client** in any AI function — a prompt-injected tool can at worst touch the caller's own rows
(RLS), and destructive tools require confirmation (PR4). Inputs are Zod-validated at the boundary.

**Guardrails that bound the owner's key** (migration `20260624010000_ai_usage_and_budget.sql`):

- **Per-user rate limits** — `ai_usage` (append-only event rows; same owner-scoped RLS pattern
  as every table) + `ai_usage_check_and_record` (**SECURITY INVOKER**: counts the caller's
  trailing-hour/day rows for a feature, raises when over, else records the request). Append-only
  rows (not a mutable counter) avoid a read-modify-write race and need no cron reset — the
  trailing window self-expires.
- **Global monthly budget kill-switch** — `ai_budget_ledger`, one row per `YYYY-MM` accumulating
  spend in micro-dollars. It is **global** (not user-scoped), so RLS can't express "only the
  system writes it"; instead the table has RLS on with **no grants and no policies** → invisible
  to app roles, reachable **only** through `ai_budget_check` / `ai_budget_add` (**SECURITY
  DEFINER**, run as owner). This is the deliberate way to keep the **service-role key out of the
  functions**: the ledger is reached via these RPCs under the caller's JWT, never an admin client.
  `auth.uid()` still identifies the caller inside a DEFINER function (it reads the JWT claim, not
  the function owner). Monthly reset is cron-free — a new month is a new PK row at zero (the same
  "row-existence is the reset" philosophy as `daily_state`, ADR-0007).

**Cost model.** `claude-sonnet-4-6` for both AI features (cost-aware choice). Cost is computed
from the response `usage` at Sonnet pricing ($3/$15 per 1M in/out) into micro-dollars
(`input*3 + output*15`) and added to the ledger post-call. **Balanced tier** (chosen 2026-06-24):
global cap **$20/month**; per-user **chat 30/hour + 100/day**, **Plan My Day 10/day**. Limits +
cap are constants in `guardrails.ts` — tunable without a schema change.

**Verified.** `supabase db reset` applies the migration; a psql proof confirms the rate-limit
raises after N, the kill-switch returns negative remaining once over cap, `ai_budget_ledger` is
`permission denied` for `authenticated`, and the DEFINER functions raise for an anon caller.
The `ai-status` function was driven end-to-end (`supabase functions serve` + curl): authed →
200 + status; no token → 401. Deno unit tests cover the CORS origin-lock and the cost math.

**CORS caveat (local).** `supabase functions serve` injects a permissive
`Access-Control-Allow-Origin: *` at the local gateway, so the origin-lock can't be observed via
local curl; the function's own headers are what apply in production (this is why every Supabase
function sets its own CORS). The lock is verified by the `cors.ts` deno unit test; re-verify
against the deployed function in Stage 6.

**Consent deviation (recorded).** The original "AI opt-in, off by default" gate is **deferred**
for the invite-only MVP (ADR-0014): AI is available to every signed-in/trusted user, bounded by
the guardrails above rather than per-user consent. Re-adding consent later is a thin layer (a
boolean + a one-time notice gating the panels + a server-side check) — no rework of this
architecture. The planner stays fully usable without AI.

**Deferred:** CI auto-deploy of functions (manual `supabase functions deploy` for now → Stage 6);
a public version's billing model (OpenRouter OAuth / paid SaaS — never raw BYOK; ADR-0014).

## ADR-0016 — Plan My Day: client payload + server-read schedule, structured output via forced tool use

**Date:** 2026-06-24 · **Stage:** 4 (PR3)

Plan My Day is a `plan-my-day` Edge Function + a modal panel. Decisions:

- **Client builds the task payload; the function reads the schedule.** The frontend assembles the
  day's data (`buildPlanRequest`) reusing the *same* `src/lib` scoring/recurring/date logic the grid
  and list use — so the "on-grid = not staged, not done today, not recurring" filtering and the
  tz-aware `daysUntil` live in ONE place, not re-implemented in Deno. But the **schedule + timezone
  are read server-side** from `user_schedule` (authoritative, not client-trusted), and **weather** is
  fetched server-side. This mirrors the original (client sent task/habit lines; server held the
  schedule) while keeping the trust boundary right.
- **Structured output via forced tool use, not fence-stripping.** The function calls Anthropic with a
  single `emit_plan` tool and `tool_choice: {type:'tool'}`, then reads the tool-use input as the plan.
  This guarantees a parseable, schema-shaped `{headline, availableTime, bigRock|null, smallRocks[],
  habitNote}` — retiring the original server's brittle ` ```json `-fence `JSON.parse` (LOGIC-TO-PORT
  §12). Robust across SDK versions (no reliance on a specific structured-output API).
- **Prompt redesigned, not ported verbatim.** Same inputs (schedule slots, weather, "habits must
  appear", weekend/Sunday handling, "never schedule running") but restructured for reliability:
  assess-urgency-first, an explicit "a light/rest day is valid" path, firmer "don't cram". Lives in
  `_shared/plan-prompt.ts`, unit-tested (weekday/Saturday/Sunday branches, empty grid).
- **Weather cache** (`weather_cache`, migration `20260624020000`): a shared ~30min cache so repeated
  clicks don't hammer wttr.in. Global state, so the same pattern as `ai_budget_ledger` — RLS on with
  no grants/policies, reached only via DEFINER `weather_cache_get/put` (no service-role key).
- **Guardrails reused:** `precheck('plan_my_day')` (10/day) + the global budget kill-switch; the
  panel reads `useAiStatus().paused` to show an "AI paused this month" notice up front. (Known minor:
  a failed attempt still counts one rate-limit unit, since precheck records before the model call —
  acceptable, and it bounds retry-spam.)

**Verified:** migrations apply; the function was driven via `supabase functions serve` + curl —
401 without auth, 400 on a malformed payload (Zod), and a graceful structured error at the model
boundary without a key (proving the SDK/zod npm imports load in the edge runtime and the whole
auth→guardrail→schedule→weather pipeline runs). 9 frontend + 5 prompt-builder unit tests green.
**Live model verification** (a real generated plan) needs the owner key set locally (`--env-file`)
or the deployed function — the panel renders plan/paused/loading/error states are unit-tested.

## ADR-0017 — Streaming chat: manual tool loop, client-held history, confirm-before-destructive

**Date:** 2026-06-25 · **Stage:** 4 (PR4)

The chat (`ai-chat` Edge Function + `ChatPanel`) is the largest, most security-sensitive surface:
conversational AI with tools that mutate the caller's tasks. Decisions:

- **Manual streaming loop, NOT the SDK auto tool-runner.** We want real token streaming AND a
  pause for confirmation/budget mid-conversation; the auto-runner loops straight to `end_turn` with
  no pause point. So we own the loop: `messages.stream()` per turn → stream `text` deltas →
  inspect `stop_reason` → execute tools or pause → feed `tool_result` back → repeat. Capped at
  `MAX_TOOL_ITERATIONS=8` per request (bounds runaway tool loops + budget burn).
- **Stateless / client-held history.** Edge Functions have no session, so the client holds the
  Anthropic `messages[]` and resends them each turn. The confirm round-trip echoes the history plus
  an accumulating `approvedToolUseIds` set. SSE event types: `text-delta`, `tool-result`,
  `tool-pending-confirmation`, `message`, `done`, `error` (in-band; HTTP stays 200 so partial text
  can stream before a failure).
- **Confirm before destructive ops — enforced in code, atomically.** `complete_task` and
  `delete_task` are a **server-side** destructive set (never trusted from the model). A per-turn
  **pre-scan** pauses and executes NOTHING in a turn until all its destructive tools are confirmed —
  so a resume can never re-run already-executed siblings (the multi-tool-in-one-turn hazard).
  Confirmation can't be forged: the model never sees or sets `approvedToolUseIds`; the client sets
  them only from a real user click. Decline is client-side (append a declined `tool_result`).
- **Prompt-injection containment.** Every tool DB write goes through the **caller's JWT** client
  (`auth.ts`), so RLS applies and the model never supplies `user_id` — task text that says "delete
  everything" can at worst touch the caller's own rows, and destructive ops still require
  confirmation. The system prompt frames task text as *data, not instructions*. Tool inputs are
  Zod-validated before any DB call (a hallucinated UUID matches zero rows → a clear "not found");
  the grid is seeded into the system prompt so the common edit case needs no `list_tasks` hop.
- **Placement tool (Discrepancy #5).** The due-date → x/y/staged auto-placement (BabyClaw/chat
  behaviour, never in the old client/server) is implemented fresh in `_shared/placement.ts` and used
  by `create_task` / `set_due_date`; exhaustively unit-tested at every bucket boundary.

**Verified:** `deno check` + 23 deno unit tests (placement boundaries, the `localDateInTZ` port,
tool schemas/validation/classification); the function via curl — 401 (no auth), 400 (malformed),
and a **200 SSE stream with a graceful in-band error** at the model boundary without a key (proving
the SDK/zod/supabase npm imports load in the edge runtime and auth/Zod/guardrail/grid-seed all run);
135 vitest incl. the SSE stream handling + the confirm round-trip (asserts the approved id is
resent) + the panel render (bubbles, the confirmation banner, paused). In-browser: the slide-over
opens, a send streams a user bubble + a graceful error, clean console. **Live tool execution** (the
model actually calling tools, and the confirmation dialog firing on a real destructive call) needs
the owner key — deployed, or local `supabase functions serve --env-file`.

**Deferred:** an MCP server exposing the same tools for the Claude app (Track 2) — the tool logic
lives in `_shared` so it can be reused without a reimplementation.

## ADR-0018 — Golden-path E2E harness: DB-backed local suite, mocked AI, CI stays smoke-only

**Date:** 2026-06-25 · **Stage:** 4.5 (PR1)

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

## ADR-0019 — Visual urgency: pure-lib style tiers + global keyframe (Stage 5 PR1)

**Date:** 2026-07-02 · **Stage:** 5 (PR1)

Stage 5's first polish PR ports EisenClaw's "warmth = the data" layer (glow, pulse, staleness) onto
placed cards + cluster bubbles. Decisions:

- **Ported into a pure lib, not inlined in the component.** `src/lib/visual-urgency.ts` exposes
  `urgencyGlowStyle(daysUntilDue)` and `stalenessStyle(task, now?)`, returning plain style objects
  (`{boxShadow, animation?}` / `{filter, opacity}`) or `null` for "no effect". The exact rgba/px
  tiers (LOGIC-TO-PORT §4/§5, html:77-95) live in ONE place and are pinned by
  `visual-urgency.test.ts` at every boundary — so a value change is a deliberate, reviewed diff, not
  an accidental drift. `GridCard`/`ClusterBubble` only spread the result. This mirrors how scoring /
  recurring / clustering math already live in `src/lib` and the components stay presentational.
- **Applied inline; the pulse keyframe is global.** The glow is a multi-layer `box-shadow` with a
  baked-in drop shadow, set as an inline style (inline wins over the resting Tailwind `shadow-*`
  class, including on hover, so the glow persists). Keyframes can't be inline, so `urgency-pulse`
  lives in `src/index.css` and is referenced by name from the inline `animation`.
- **`daysUntil` is computed by the caller (GridView), not the card.** The card is handed a
  `daysUntilDue: number | null` prop so the timezone (`useTimeZone`) resolves in one place; the same
  value drives the cluster bubble's glow (nearest due date among non-recurring members) and the
  card's due badge. Staleness needs only `created_at`/`staged`, so the card computes it directly.
- **Scope guards match EisenClaw exactly:** glow + staleness apply only to **non-recurring** cards
  (a recurring task carries its own `RC_COLOR` status), never to done cards (already off-grid), and
  staged tray cards never desaturate. The **non-recurring due badge** (`overdue`/`today`/`Nd`,
  html:590) was missing from the Stage 3 card and is added here as the textual half of the layer.
- **Accessibility beyond parity:** a `@media (prefers-reduced-motion: reduce)` rule stops the pulse
  (keeping the static ring) — a deliberate, non-parity enhancement for a "professional app".

**Verified.** 36 unit/DOM tests (every glow/staleness tier pinned; GridView asserts the pulse
`animation`, stale `opacity`, due-badge text, and recurring suppression land on the real node);
typecheck/lint/format green; a throwaway harness rendering the real components across all tiers was
screenshotted in-browser (glow gradient, overdue pulse, staleness fade, cluster glow) and removed.
Golden suite unaffected — no spec sets a due date, so glow/badge never render in it; selectors
unchanged.
