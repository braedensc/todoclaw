# SERVICES.md

Every external account and service Todoclaw uses: what each does, how they connect,
which keys live where, and links to dashboards. Updated as each service is added.

---

## GitHub — source, CI, security scanning

- **Repo:** [braedensc/todoclaw](https://github.com/braedensc/todoclaw) — **public**, created 2026-06-23.
- **Auth (local):** `gh` CLI logged in as `braedensc` (scopes: `repo`, `workflow`, `read:org`, `gist`).
- **CI:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on push to `main` and every PR.
  Currently: secretlint + forbidden-path gate. Lint / typecheck / test jobs are added in Stage 2.
- **Branch protection (`main`):** require a PR + the `Secret scan + forbidden paths` check passing,
  strict (branch must be up to date), **enforced for admins** (unbypassable). 0 required approvals
  (solo repo). Settings → Branches.
- **Security features enabled** (Settings → Code security):
  | Feature | State | What it does |
  |---|---|---|
  | Secret scanning | on (auto, public) | Flags committed secrets |
  | Push protection | enabled | Blocks a push containing a detected secret, server-side |
  | Dependabot security updates | enabled | Auto-PRs to fix vulnerable dependencies |
  | Secret validity checks | enabled | Reports whether a leaked secret is still active |

This is **layer 3** of the security model (the unbypassable gate). Layers 1–2 (Claude Code
hooks + git pre-commit hooks) live in the repo and run locally — see [CLAUDE.md](../CLAUDE.md).

---

## Supabase — Postgres, Auth, RLS

**Local (Stage 1 PR #2) — done.** Development runs against a local Supabase stack in Docker
(`supabase/config.toml`). It's free, offline, and disposable.

- **Run it:** `supabase start` (needs Docker). `supabase status` prints the local URLs/keys;
  `supabase stop` shuts it down. See [SETUP.md](SETUP.md).
- **Local URLs:** API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`,
  mail catcher (Mailpit) `http://127.0.0.1:54324`.
- **Keys:** the local anon/service-role keys are the **standard public demo keys** — identical
  on every Supabase install, not secrets. Only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
  go into `.env.local` (gitignored). The service-role key is not used by app code.
- **Schema:** `supabase/migrations/` (version-controlled). First migration: `tasks` table with
  RLS, owner-scoped policies, soft-delete, and no client hard-delete. `supabase db reset`
  re-applies migrations to the **local** DB only.

**Cloud (Stage 1 PR #3) — pending.** One production project (anon + service-role keys, auth
hardening, daily encrypted backups). Documented here when provisioned.

---

## Not yet provisioned

Added in later stages; documented here when they are:

- **Supabase cloud** (Stage 1 PR #3) — production project + auth hardening + backups.
- **Vercel** (Stage 1 PR #3) — frontend hosting + PR previews.
- **Anthropic Console** (Stage 4) — API key for in-app AI; spend limits set here.
- **Sentry** (Stage 2) — error monitoring; DSN.

---

## Security incident runbook

When a Dependabot / secret-scanning / Sentry alert fires:
1. Assess severity.
2. Let Dependabot open the fix PR (or Claude bumps it); CI runs the full gate.
3. Review → merge → deploy.
4. **If a key leak is suspected, rotate the affected key immediately** at its provider dashboard,
   then update the corresponding env var / Actions secret.
