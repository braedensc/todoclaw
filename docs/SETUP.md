# SETUP.md

How to run Todoclaw locally end-to-end: prerequisites, env vars, common commands, and
troubleshooting. Filled in incrementally as the stack is wired up.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node | **22** (see `.nvmrc`) | Vite 8 needs Node ≥ 20.19 / 22.12. Use `nvm use` in the repo root. |
| npm | 10+ | Ships with Node 22. |
| Docker Desktop | running | Required by local Supabase (added in Stage 1 PR #2). |
| Supabase CLI | latest | `brew install supabase/tap/supabase` (added in PR #2). |

> **This shell may default to an older Node.** Always run `nvm use` (reads `.nvmrc` → 22)
> before any `npm`/`vite`/`tsc` command. Node 16 cannot run Vite 8.

## First-time setup

```bash
nvm use                 # select Node 22 (.nvmrc)
npm install             # installs deps + sets up Husky pre-commit hook
```

## Environment variables

```bash
cp .env.example .env.local   # then fill in the two values
```

`.env.local` is gitignored and holds the real local values. Fill it from the output of
`supabase start` (see the local-Supabase section, added in PR #2):

- `VITE_SUPABASE_URL` — local API URL (e.g. `http://127.0.0.1:54321`)
- `VITE_SUPABASE_ANON_KEY` — the local anon key printed by `supabase start`

The anon key is public by design (RLS is the real guard). **Never** put the service-role key
in `.env.local` or any frontend file.

## Common commands

```bash
npm run dev          # Vite dev server → http://localhost:5173
npm run build        # tsc -b (typecheck) + vite build → dist/
npm run preview      # serve the production build locally
npm run typecheck    # tsc -b, no emit
npm run lint         # ESLint (flat config)
npm run format       # Prettier — rewrite files
npm run format:check # Prettier — check only (what CI runs)
npm test             # Vitest (unit + component) once
npm run test:watch   # Vitest in watch mode
```

## Testing

Unit + component tests use **Vitest** + **React Testing Library** under jsdom (Stage 2 PR #2).
Test files sit next to their subject as `*.test.ts(x)`; jest-dom matchers and RTL cleanup are
wired in `src/test/setup.ts`. Tests need no Supabase/network — component tests `vi.mock` the
data hooks. Run `npm test` (CI runs the same).

**End-to-end (Playwright, PR #5).** Specs live in `e2e/*.spec.ts`.

```bash
npx playwright install chromium   # one-time: download the browser
npm run test:e2e                  # starts the dev server + runs the smoke (chromium)
```

The config (`playwright.config.ts`) starts the Vite dev server itself with dummy Supabase env,
so the smoke runs with no `.env.local` and no database (the app shows the sign-in form when
logged out). CI runs this same smoke as a **non-required** job.

**Golden-path suite (DB-backed, local-only — Stage 4.5).** A second config drives the app against
the **running local Supabase stack** (auth → RLS → render → real drag), with the AI Edge Functions
mocked (no Anthropic spend). It stays out of CI by design — CI is smoke-only (ADR-0011 / ADR-0018).

```bash
supabase start                    # the golden suite needs the local stack up (it fails fast if not)
npm run test:e2e:golden           # seeds a test user, signs in, runs e2e/golden/**
```

The golden config (`playwright.golden.config.ts`) resolves the real local keys from
`supabase status -o env`, starts its own dev server on port **5174**, and runs a Playwright **setup
project** (`e2e/golden/auth.setup.ts`) that creates the fixed test user (`e2e@todoclaw.test`) via
the admin API, wipes its rows for a clean slate, signs in, and saves the session to
`e2e/.auth/state.json` (gitignored). Specs import `{ test, expect }` from `e2e/helpers/fixtures.ts`,
whose page fixture re-wipes the user's rows and lands on the signed-in app before every test (and
refuses to run with a `--workers` override — the suite shares one user, so it must stay serial).
The browser is pinned to `en-US` / UTC for determinism. Add `npx playwright install chromium` if
you haven't already.

Two spec projects run off that one setup: **`chromium`** (Desktop Chrome) runs the desktop specs
(`*.golden.spec.ts`), and **`chromium-mobile`** (Pixel 7 viewport + touch, Stage 5) runs the mobile
specs (`*.mobile.golden.spec.ts` — tap-to-place and the bottom tab bar). Both depend on the same
seeded session; the per-test wipe keeps them independent despite sharing the user. Run one project
with `npm run test:e2e:golden -- --project chromium-mobile`.

One golden spec (`e2e/golden/eisenclaw-seed.golden.spec.ts`) opts into realistic seeded data
(Braeden's real EisenClaw tasks/habits) instead of the empty slate — see
`scripts/eisenclaw-seed/README.md`.

## Local Supabase

Development runs against a local Supabase stack in Docker — free, offline, disposable.

```bash
# one-time: install the CLI
brew install supabase/tap/supabase

# start / inspect / stop the local stack (Docker must be running)
supabase start            # boots Postgres, Auth, PostgREST, Studio, … (first run pulls images)
supabase status           # prints local URLs + keys
supabase stop             # shut it down

# apply migrations to the LOCAL db (re-runs every migration from clean)
supabase db reset
```

Local URLs: API `http://127.0.0.1:54321` · Studio `http://127.0.0.1:54323` · Mailpit (catches
sign-up emails) `http://127.0.0.1:54324`.

### Create `.env.local` from the running stack

Claude cannot write `.env.local` (the security hook blocks `.env` writes and JWT values), so
create it yourself. With the stack running, this maps the local values to the Vite var names:

```bash
supabase status -o env \
  --override-name api.url=VITE_SUPABASE_URL \
  --override-name auth.anon_key=VITE_SUPABASE_ANON_KEY \
  | grep '^VITE_' > .env.local
```

The anon key is public by design (RLS is the guard). Never put the service-role key in
`.env.local`.

**Working in multiple worktrees?** Use `scripts/dev-worktree-login.sh <slug>` instead — it
does the above *and* creates a dedicated `<slug>@todoclaw.local` login for that worktree, so
parallel sessions don't share one account. See
[COLLABORATION.md](COLLABORATION.md#running-several-claudes-at-once--git-worktrees).

### Run the app against it

```bash
nvm use && npm run dev          # http://localhost:5173
```

The app is **sign-in-only** (invite-only — ADR-0014). Create a local user in Studio
(`http://127.0.0.1:54323` → Authentication → Add user; local email confirmation is off), then
sign in, add a task, and it renders from Postgres through RLS.

To populate that user with realistic data instead of starting blank, run
`npm run seed:eisenclaw -- --email <that user's email>` — see `scripts/eisenclaw-seed/README.md`.

### Schema / migrations

- Migrations live in `supabase/migrations/` (version-controlled, each with intent + down path).
  Tables: `tasks`, `habits`, `daily_state`, `user_schedule` (all owner-scoped RLS; see
  docs/ARCHITECTURE.md ADR-0005/0007).
- Add one with `supabase migration new <name>`, write the SQL, then `supabase db reset` to apply
  locally. **`db reset` only ever touches the local DB** — the Claude Code hook blocks
  `--linked`/remote resets.
- **Migrations are serialized:** pull latest `main` before generating one so your timestamp
  sorts last, and never hand-edit a timestamp. Each migration file needs a unique timestamp
  prefix (Supabase keys `schema_migrations` by it).
- AI guardrail tables (`ai_usage`, `ai_budget_ledger`) arrive with Stage 4 (ADR-0015).

## Local Edge Functions (AI — Stage 4)

AI runs in Supabase Edge Functions (Deno 2), server-side only. With the stack running:

```bash
supabase functions serve        # serve all functions, hot-reload; http://127.0.0.1:54321/functions/v1/<name>
```

- **Secrets** (the owner Anthropic key, etc.) are set with `supabase secrets set` for the cloud
  project; for local serve, pass a `--env-file`. Claude cannot set these — the hook blocks
  `.env*` + the key value. The `ai-status` proof endpoint needs no key (it makes no model call).
- **Deno toolchain:** `supabase/functions/` is checked with Deno, not the frontend ESLint/tsc.
  Run `brew install deno`, then from `supabase/functions/`: `deno task test` (unit tests for the
  pure logic — CORS lock, cost math). Prettier still formats this tree.
- **CORS is locked** to `ALLOWED_ORIGIN` (defaults to `http://localhost:5173`). Note: local
  `supabase functions serve` injects a permissive `*` at the gateway, so the lock is verified by
  the deno unit test, not local curl (see `supabase/functions/README.md`).
- Deploy is **manual** for now (`supabase functions deploy <name>`); CI auto-deploy → Stage 6.

## Troubleshooting

- **`vite: command not found` / engine errors** — wrong Node. Run `nvm use` (need Node 22).
- **`tsc -b` fails on `Buffer`/`Request` in Vite's types** — `@types/node` missing; run
  `npm install`.
- **Port 5173 already in use** — another `vite dev` is running; stop it or Vite picks the next
  free port.
