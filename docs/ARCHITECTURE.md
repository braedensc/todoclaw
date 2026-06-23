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

## ADR-0004 — Drag/drop spike deferred to Stage 3 (not Stage 1)

**Date:** 2026-06-23 · **Stage:** 1 (PR #1)

The master plan calls for spiking @dnd-kit vs. raw pointer events for the free-canvas grid.
That belongs with grid work in **Stage 3**, not the Stage 1 skeleton — Stage 1 only proves the
pipeline (toolchain → DB → auth → render), so no drag/drop dependency is added yet.

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
