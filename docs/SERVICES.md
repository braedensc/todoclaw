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
   | `BACKUP_DATABASE_URL` | the **`postgres`** user's **Session-pooler** connection string (IPv4). Get it from the dashboard's green **Connect** button → **Session pooler** (port **5432**), drop in your DB password, and append `?sslmode=require`. Form (password omitted): `postgresql://postgres.<ref>@aws-<N>-<region>.pooler.supabase.com:5432/postgres?sslmode=require` — the `aws-<N>-` prefix is project-specific (ours is **`aws-1-us-west-2`**; `aws-0` returned "tenant not found"). ⚠️ **Not** the direct `db.<ref>.supabase.co` host (IPv6-only, unreachable from GitHub runners) and **not** a custom role — the free pooler only accepts the built-in `postgres` user. Treat this secret as full-DB access; rotate the DB password if exposed. The read-only `backup_ro` role exists but can't be used via the free pooler — it's reserved for a future least-privilege upgrade (Supabase IPv4 add-on or a self-hosted runner). |
   | `BACKUP_GPG_PASSPHRASE` | a strong passphrase to encrypt dumps (store it in your password manager — **without it the backups can't be decrypted**) |

### Backups

`.github/workflows/backup.yml` runs **daily (09:00 UTC)** + on-demand. It `pg_dump`s the
`public` schema (via the **session pooler**, IPv4, as the `postgres` user), encrypts with
AES-256, and uploads an **encrypted artifact (90-day retention)**. Until both secrets are set it
runs green but skips. Trigger manually from the **Actions** tab to test. **Verified working
2026-06-23** — produced an encrypted artifact from the cloud DB.

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

### Database network security (decisions, 2026-06-23)

- **Enforce SSL → ON.** Settings → Database → *Enforce SSL on incoming connections*. Forces
  TLS on every **direct** Postgres connection. The app is unaffected (it talks to the API over
  HTTPS, never direct DB). When enabled, append **`?sslmode=require`** to `BACKUP_DATABASE_URL`
  so the backup job negotiates TLS explicitly and can't silently fall back.
- **Network / IP restrictions → OFF for now (deliberate).** They gate only *direct DB*
  connections (port 5432), **not the API** — and the API (anon key + RLS + JWT) is the actual
  internet-facing surface, already locked down. Turning them on would:
  - **break the daily backup job** — GitHub Actions runners have no stable IP (huge rotating
    Azure ranges; can't be allow-listed without effectively allowing the internet), and
  - **block `db push`** from a roaming dev laptop.
  Direct DB access is already gated by secret role passwords **+ SSL**, which is sufficient for
  a two-person app.
  - **Enable later** once backups egress through a **static IP** (a self-hosted runner or a
    small proxy): then allow-list that IP + your home/office IP and lock the DB port down hard.
    A Stage 6 hardening step.
- **Backup auth → `postgres` via session pooler (not least-privilege, deliberate).** The free
  pooler only accepts the built-in `postgres` user, and the direct connection (which *would*
  accept the read-only `backup_ro`) is IPv6-only / unreachable from GitHub runners. So the
  backup secret holds the `postgres` credential — rotate it if exposed. Restoring strict
  least-privilege (`backup_ro`) needs the Supabase **IPv4 add-on** or a **self-hosted runner** —
  the same future hardening as network restrictions above.

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
