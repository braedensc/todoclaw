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

> Added in Stage 1 PR #2 (`supabase start`, migrations, seeding). Placeholder for now.

## Troubleshooting

- **`vite: command not found` / engine errors** — wrong Node. Run `nvm use` (need Node 22).
- **`tsc -b` fails on `Buffer`/`Request` in Vite's types** — `@types/node` missing; run
  `npm install`.
- **Port 5173 already in use** — another `vite dev` is running; stop it or Vite picks the next
  free port.
