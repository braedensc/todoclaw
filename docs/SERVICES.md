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

**Cloud (Stage 1 PR #3) — code ready, awaiting provisioning.** One production project. The
PR #3 code (`vercel.json`, `.github/workflows/backup.yml`, the `backup_role` migration) is
merged-ready; it activates once you provision the accounts and set the secrets below.

---

## Production deploy & backups — Stage 1 PR #3

> One production Supabase project = prod; local Docker = dev. No staging (zero cost). The
> code is written; this is the **human provisioning checklist** (accounts, OAuth, secrets).

### Provisioning checklist (you, in dashboards)

1. **Supabase cloud project**
   - Create the project; copy the **Project URL** + **anon** key (for Vercel) and note the
     **service-role** key (server-only; never the frontend).
   - **Auth hardening** (Authentication → Providers/Policies): require **email confirmation**,
     enable **leaked-password protection**, set a **password policy**, short **JWT expiry** +
     refresh rotation, **disable anonymous sign-ins**, and restrict **redirect/allowed URLs**
     to the Vercel domain + `http://localhost:5173`.
   - Apply the schema: `supabase link --project-ref <ref>` then **one-time** `supabase db push`
     (the documented bootstrap exception; CI-driven migrations come in Stage 2/6).
   - Create the backup role's password (SQL editor — not committed):
     `alter role backup_ro with password '<strong-generated>';`
2. **Vercel**
   - Import the GitHub repo (OAuth). Framework preset: Vite; build `npm run build`; output
     `dist`. `vercel.json` already sets the security headers/CSP.
   - Add **production env vars**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (cloud values).
3. **GitHub Actions secrets** (repo → Settings → Secrets → Actions) — enables daily backups:

   | Secret | Value |
   |---|---|
   | `BACKUP_DATABASE_URL` | the `backup_ro` role's Postgres connection string — form `postgresql://backup_ro@HOST:5432/postgres` with the password inserted after the role name (Supabase shows the full string under Project Settings → Database) |
   | `BACKUP_GPG_PASSPHRASE` | a strong passphrase to encrypt dumps (store it in your password manager — **without it the backups can't be decrypted**) |

### Backups

`.github/workflows/backup.yml` runs **daily (09:00 UTC)** + on-demand. It `pg_dump`s the
`public` schema as the least-privilege `backup_ro` role, encrypts with AES-256, and uploads an
**encrypted artifact (90-day retention)**. Until both secrets are set it runs green but skips.
Trigger manually from the **Actions** tab to test.

### Restore runbook

```bash
# 1. download the db-backup-<run_id> artifact from the Actions run, then:
gpg --batch --passphrase "$BACKUP_GPG_PASSPHRASE" -d backup.sql.gpg > backup.sql
# 2. restore into a fresh/throwaway database (local or a new Supabase project):
psql "<target-db-url>" < backup.sql
# 3. verify row counts match expectations.
```

Proven locally before ship (PR #3): seed → dump → AES-256 encrypt → wipe table → decrypt →
restore → rows + RLS recovered.

---

## Not yet provisioned

Added in later stages; documented here when they are:

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
