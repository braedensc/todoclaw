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
npm run dev         # Vite dev server → http://localhost:5173
npm run build       # tsc -b (typecheck) + vite build → dist/
npm run preview     # serve the production build locally
npm run typecheck   # tsc -b, no emit
```

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

### Run the app against it

```bash
nvm use && npm run dev          # http://localhost:5173
```

Sign up (local has email confirmation off, so you're logged in immediately), add a task, and it
renders from Postgres through RLS.

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

## Troubleshooting

- **`vite: command not found` / engine errors** — wrong Node. Run `nvm use` (need Node 22).
- **`tsc -b` fails on `Buffer`/`Request` in Vite's types** — `@types/node` missing; run
  `npm install`.
- **Port 5173 already in use** — another `vite dev` is running; stop it or Vite picks the next
  free port.
