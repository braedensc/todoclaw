# SERVICES.md

Every external account and service TodoClaw uses: what each does, how they connect,
which keys live where, and links to dashboards. Updated as each service is added.

> **Looking for the at-a-glance list?** [INVENTORY.md](INVENTORY.md) is the value-free roster —
> every service, account, and env var/secret in tables, with where each one lives. This file is the
> narrative detail (the _why_, provisioning steps, and runbooks) behind that roster.

---

## GitHub — source, CI, security scanning

- **Repo:** [braedensc/todoclaw](https://github.com/braedensc/todoclaw) — **public**, created 2026-06-23.
- **Auth (local):** `gh` CLI logged in as `braedensc` (scopes: `repo`, `workflow`, `read:org`, `gist`).
- **CI:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on push to `main` and every PR.
  Four parallel jobs: `Secret scan + forbidden paths` (secretlint + path gate), `Lint`
  (ESLint + Prettier check), `Typecheck` (`tsc -b`), `Test` (Vitest). Added in Stage 2 PR #4.
- **Branch protection (`main`):** require a PR + passing checks, strict (branch must be up to
  date), **enforced for admins** (unbypassable). 0 required approvals (solo repo). Settings →
  Branches. **Required contexts:** `Secret scan + forbidden paths` today; after PR #4 merges, add
  `Lint`, `Typecheck`, `Test` (each job's `name:` *is* its context). Run this **only after the
  new jobs have reported on `main`** — otherwise every open PR wedges waiting on a context that
  has never run:
  ```bash
  gh api -X POST repos/braedensc/todoclaw/branches/main/protection/required_status_checks/contexts \
    -f 'contexts[]=Lint' -f 'contexts[]=Typecheck' -f 'contexts[]=Test'
  ```
  (POST to `/contexts` *adds* without dropping the existing one.)
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
- **Schema:** `supabase/migrations/` (version-controlled). Tables: `tasks` (Stage 1) plus
  `habits`, `daily_state`, `user_schedule` (Stage 2, PR #1) — all owner-scoped RLS, soft-delete
  where applicable, no client hard-delete (see ADR-0005, ADR-0007). `supabase db reset`
  re-applies migrations to the **local** DB only.

**Cloud — LIVE (provisioned 2026-07-02).** One production project (`hknmhkzumkjhylxclrcy`): schema
applied, Vercel + backups active, and the CI-driven deploy pipeline (ADR-0022) deploying Edge
Functions on merge — smoke-verified in prod (see **Production deploy pipeline** below). The
checklist that follows is the original Stage 1 PR #3 provisioning record; the remaining open items
are the deliberately-deferred backup least-privilege hardening (ADR-0006/ADR-0023).

---

## Production deploy & backups — Stage 1 PR #3

> One production Supabase project = prod; local Docker = dev. No staging (zero cost). **Status
> 2026-07-02: provisioning DONE** — project live, secrets set, backups verified. The checklist
> below is the historical record + the deferred backup-hardening items.

### Provisioning checklist (you, in dashboards)

1. **Supabase cloud project**
   - Create the project; copy the **Project URL** + **anon** key (for Vercel) and note the
     **service-role** key (server-only; never the frontend).
   - **Auth hardening** (Authentication → Providers/Policies): require **email confirmation**,
     enable **leaked-password protection**, set a **password policy**, short **JWT expiry** +
     refresh rotation, **disable anonymous sign-ins**, and restrict **redirect/allowed URLs**
     to the Vercel domain + `http://localhost:5173`.
   - **Invite-only (Stage 4, ADR-0014):** Authentication → **disable public sign-ups** (turn off
     "Allow new users to sign up" / "Enable email signup"). This dashboard toggle is the real gate;
     the frontend has no open sign-up. Everyone invited is trusted, which is what lets AI run on the
     owner's key (ADR-0015). Two ways to onboard someone new:
     - **Dashboard** — Authentication → Users → *Invite / Add user* (invite by email).
     - **In-app invite codes (ADR-0030)** — the owner opens "Invite someone", generates a link, and
       texts it; the invitee redeems it to create their account. Keep sign-up **disabled** — redeem
       uses the service-role admin API, gated by the code. One-time setup:
       `supabase secrets set OWNER_USER_ID=<owner's auth.users uuid>`. That single server secret is
       the whole owner gate — the frontend reveals the Invite/Admin UI by asking the `admin` Edge
       Function's `whoami` action, so there is no `VITE_OWNER_USER_ID` to set (the owner's id never
       ships in the client bundle).
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

## Keep-alive — free-tier anti-pause (Stage 6)

Free-tier Supabase **pauses a project after ~7 days of no activity**; a paused project stops
serving the API (an outage). [`.github/workflows/keepalive.yml`](../.github/workflows/keepalive.yml)
prevents that: **daily (08:17 UTC)** it makes one tiny read-only REST request
(`GET /rest/v1/tasks?select=id&limit=1`) to the production project, which resets the inactivity
timer. It costs nothing (well within free Actions minutes) and reads no data — the anon role is
granted nothing on `tasks`, so Postgres **denies** the query (HTTP 401), but processing it is
exactly what counts as project activity. So `401`/`403` is the normal healthy response here (the
job treats them, plus `200`/`206`, as success and only fails on `5xx`/unreachable).

Configure it once (repo → Settings → **Secrets and variables → Actions**):

| Name | Kind | Value |
|---|---|---|
| `SUPABASE_URL` | **Variable** | `https://<prod-ref>.supabase.co` (the prod Project URL) |
| `SUPABASE_ANON_KEY` | **Secret** | the prod project's **anon** (public) key — Supabase → Settings → API |

The anon key is public (it already ships in the frontend bundle, gated by RLS); it's stored as a
Secret only for log-masking hygiene. Until both are set the workflow runs green but **skips**
(same pattern as the backup job). Scheduled workflows only run from `main`, so it activates on
merge — trigger it once manually from the **Actions** tab (`workflow_dispatch`) to confirm it
returns a `200`/`401` (both mean the project is awake).

---

## Proactive notifications — hourly dispatch (Stage 6, ADR-0031)

Opt-in morning **plan** + evening **recap** Web Push. `.github/workflows/notify.yml` POSTs the
`dispatch-messages` Edge Function every hour; the function decides who is due (each user's local
morning/evening hour, quiet-hours aware) and sends. Like keep-alive/backup it SKIPS (green) until
configured, so it's never red on an unconfigured repo.

**GitHub Actions** (repo → Settings → Secrets and variables → Actions):

| Name              | Kind     | Value                                                                                                         |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `DISPATCH_URL`    | Variable | `https://<prod-ref>.supabase.co/functions/v1/dispatch-messages`                                               |
| `DISPATCH_SECRET` | Secret   | a strong random string — the function's ONLY caller gate. Set the SAME value on the Supabase project (below). |

**Supabase project** (once, via `supabase secrets set` — never committed; the hook blocks `.env*`):

```bash
# Generate the VAPID pair once with generateVapidKeys() in supabase/functions/_shared/web-push.ts.
supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com
supabase secrets set DISPATCH_SECRET=…   # the SAME value as the GitHub Actions secret above
```

**Vercel** (frontend env): `VITE_VAPID_PUBLIC_KEY` = the VAPID **public** key (public by design; the
private key stays a server-only Edge secret). Unset ⇒ the Settings notifications toggle says "not
configured". `dispatch-messages` is already in `deploy.yml`'s deploy loop. Unset VAPID ⇒ messages
still persist to the in-app inbox; only the push is skipped.

---

## Production deploy pipeline — Stage 6 (ADR-0022)

`.github/workflows/deploy.yml` applies pending **migrations** and (re)deploys the three **Edge
Functions** to the prod project after every **green CI run on `main`** (`workflow_run` on `CI` + a
success gate; `migrate` → `deploy-functions` sequential, so a failed migration blocks the function
deploy). Replaces the by-hand `supabase db push` / `supabase functions deploy`.

### Config (repo → Settings → Secrets and variables → Actions)

| Name | Kind | Status | Value |
|---|---|---|---|
| `BACKUP_DATABASE_URL` | Secret | ✅ already set | **Reused** for migrations (`db push`) — same session-pooler URL the backup job uses (`postgres` user, port 5432, `?sslmode=require`; the free pooler forces one user for read+write). No new secret needed. |
| `SUPABASE_ACCESS_TOKEN` | Secret | ✅ set 2026-07-02 | a Supabase **personal access token** — dashboard → **Account → Access Tokens → Generate new token**. Authenticates the function deploy (Management API); not a DB credential. |
| `SUPABASE_PROJECT_REF` | Variable | ✅ already set | the prod project ref (`hknmhkzumkjhylxclrcy`). |

All three are now set, and the pipeline has deployed successfully (functions live 2026-07-02). Before
that, each job **preflight-skips green** when its secret is missing (mirrors backup.yml / keepalive.yml),
so the workflow always merges without wedging anything.

### One-time prerequisites before the first function deploy works

- **Function Secrets on the project** (set via CLI, never committed) — **both set 2026-07-02** ✅:
  ```bash
  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...                        # owner key ✅ set 2026-06-25
  supabase secrets set ALLOWED_ORIGIN=https://todoclaw-psi.vercel.app      # CORS lock ✅ set 2026-07-02
  ```
  Without `ALLOWED_ORIGIN`, `cors.ts` falls back to `http://localhost:5173` and the prod origin is
  refused (in-app AI calls CORS-blocked). `SUPABASE_URL` / `SUPABASE_ANON_KEY` are auto-injected.
  **Caveat — Vercel preview deploys can't use AI:** the lock is the single prod origin, and preview
  URLs are per-deploy hashes (`todoclaw-<hash>-…vercel.app`) that won't match. This is deliberate —
  previews are for visual/UX review and must not spend the owner's Anthropic budget. The rest of the
  planner works on previews; only the AI panels CORS-block there.
- **`verify_jwt = false`** is set per-function in `supabase/config.toml` (+ `--no-verify-jwt` on
  deploy) so the CORS OPTIONS preflight reaches the function; the functions verify the JWT
  themselves (`_shared/auth.ts`). Leaving the gateway check on would 401 the preflight and break
  every AI call.

### First deploy + CORS re-verify — resolved (ADR-0015 caveat closed)

**Done ✅ (2026-07-02).** Merging #43 auto-triggered the pipeline (no manual dispatch needed): the
migrate job ran as an idempotent no-op and all three functions (`ai-status` / `plan-my-day` /
`ai-chat`) deployed. **Prod smoke passed** — allowed-origin preflight → `204` echoing
`access-control-allow-origin: https://todoclaw-psi.vercel.app`; disallowed origin → `204` with **no**
ACAO header (browser blocks it); unauth `POST` to `ai-status` → `401`; app root → `200` HTML. The
origin-lock re-verify (the ADR-0015 caveat) is reproducible any time with:

```bash
# Allowed origin → expect 204 with an Access-Control-Allow-Origin echoing it:
curl -i -X OPTIONS -H "Origin: https://todoclaw-psi.vercel.app" \
  https://hknmhkzumkjhylxclrcy.supabase.co/functions/v1/ai-status
# Disallowed origin → must get NO Access-Control-Allow-Origin header back:
curl -i -X OPTIONS -H "Origin: https://evil.example" \
  https://hknmhkzumkjhylxclrcy.supabase.co/functions/v1/ai-status
```

### Rollback

Supabase does **not** auto-run `down` migrations and `git revert` does not undo applied DDL. Roll a
schema change back by running that migration's `-- down:` block via `psql "<session-pooler-url>"`,
then deleting its row from `schema_migrations`; for a data-lossy change, restore the daily encrypted
backup (take an on-demand backup first). `vercel rollback` reverts the frontend.

---

## Sentry — error monitoring (dev mode Stage 2 PR #3 · prod hardening Stage 6, ADR-0009)

The `@sentry/react` SDK is wired but **DSN-gated**: it only initializes when `VITE_SENTRY_DSN`
is set, so it's off until you provide a DSN. Error boundaries report crashes to it. Stage 6 turns
it on in prod + adds release tracking (code done; DSN + dashboard steps are yours).

**Local setup (you, in the dashboard + locally):**
1. Create a project at [sentry.io](https://sentry.io) (platform: React). Copy its **DSN** — a
   DSN is a public ingest URL, not a secret.
2. Add it to `.env.local` (Claude can't write `.env*`): `VITE_SENTRY_DSN=<your-dsn>`. Restart
   `npm run dev`. Errors caught by the boundaries now appear in Sentry.
3. **Sentry MCP** (lets Claude read your Sentry issues): already registered **user-scoped** (in
   `~/.claude.json`, not committed) via
   `claude mcp add --scope user --transport http sentry https://mcp.sentry.dev/mcp`. It shows
   "Needs authentication" until you run `/mcp` in an interactive `claude` session and complete
   the OAuth. Collaborators run the same command on their own machines.

**Production (Stage 6) — you, in dashboards:**
1. **Vercel → Project → Settings → Environment Variables:** add `VITE_SENTRY_DSN = <your-dsn>`
   scoped to **Production**. This is the switch that makes prod Sentry live — nothing else is
   required. Redeploy to pick it up. (Optionally also scope it to **Preview** — safe now, because
   events are tagged `environment=preview` vs `production`, so you can filter preview noise out of
   prod alerts.)
2. **Release + environment tagging is automatic** — no config. The build bakes in Vercel's commit
   SHA (`VERCEL_GIT_COMMIT_SHA` → `release: todoclaw@<sha>`) and `VERCEL_ENV`
   (→ `environment: production | preview`), so each issue shows the exact deploy and which
   environment it came from. (If `VERCEL_GIT_COMMIT_SHA` is ever empty, e.g. a non-git deploy, the
   release is simply omitted.)
3. **Alerts → Alert Rules:** confirm the auto-created **"new issue"** rule is enabled and that a
   **delivery channel** is set (your email, or a Slack integration) so notifications actually reach
   you. Optionally add a rule for an error-rate spike.
4. **Source maps: intentionally not uploaded** (ADR-0009) — they'd need `@sentry/vite-plugin` + a
   `SENTRY_AUTH_TOKEN`; minified stacks + the release tag are enough for a 2-person app.

> Leaving `VITE_SENTRY_DSN` blank disables Sentry entirely (the app no-ops) — the planner works
> the same without it. This is why Vercel **preview** deploys stay silent unless you opt them in.

---

## Anthropic — in-app AI (Stage 4)

AI (Plan My Day, chat) runs on the **owner's** Anthropic key, **server-side only** in Supabase
Edge Functions. The key is never in the frontend bundle or any `VITE_*` var (ADR-0015).

**Provisioning (you, in dashboards/CLI):**

1. **Anthropic Console** ([console.anthropic.com](https://console.anthropic.com)) — create an
   API key (`sk-ant-…`). Configure **spend alerts** here — see
   **[Billing & cost alerts](#billing--cost-alerts-stage-6)** below (the in-app monthly kill-switch
   is the primary bound; Console alerts are the backstop). Anthropic is the **only** service that
   can actually run up a bill — Supabase Free and Vercel Hobby pause instead of charging.
2. **Set the function secrets** (Claude cannot — the hook blocks `.env*` + the `sk-ant-…` value) —
   **both set ✅** (`ANTHROPIC_API_KEY` 2026-06-25, `ALLOWED_ORIGIN` 2026-07-02):

   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...                       # the owner key (required)
   supabase secrets set ALLOWED_ORIGIN=https://todoclaw-psi.vercel.app     # CORS lock (prod origin)
   ```

   `SUPABASE_URL` / `SUPABASE_ANON_KEY` are auto-injected into functions — no secret needed.
   For **local** serve, pass these via `--env-file` instead (the `ai-status` proof endpoint needs
   no key — it makes no model call).
3. **Deploy the functions** — **automated by CI** (`.github/workflows/deploy.yml`, ADR-0022) and
   **live in prod since 2026-07-02**: merging #43 auto-triggered the pipeline and deployed
   `ai-status` / `plan-my-day` / `ai-chat`; the CORS origin-lock re-verify passed against the
   deployed function. See **Production deploy pipeline** above.

**Cost guardrails** (in-app, ADR-0015): per-user rate limits (chat 30/hr·100/day, Plan My Day
10/day) + a **global $20/month budget kill-switch**. If the kill-switch trips, every AI endpoint
refuses until the next month. Tunable via constants in `supabase/functions/_shared/guardrails.ts`.

> Treat the Anthropic key like any secret: if exposure is suspected, **rotate it in the Console**
> and re-run `supabase secrets set ANTHROPIC_API_KEY=…`.

---

## Billing & cost alerts (Stage 6)

Cost posture across the three paid-capable services. **Key finding:** only **Anthropic** bills per
use (owner's key) — **Supabase Free and Vercel Hobby cannot charge you**; they *pause* the resource
when a free-tier limit is hit. So real budget risk is Anthropic-only, and it's already bounded by the
in-app **$20/month kill-switch** (ADR-0015); the Console alerts below are a backstop.

### Anthropic — real spend; email alerts at $10 / $15 (you, in the Console)

The API has **no free tier** — every call costs real money. Two independent controls:

- **Email alerts (what we want):** Console → **Settings → Workspaces → [the app's workspace] →
  Limits tab → "Add notification"**. Add one at **$10** and one at **$15** (month-to-date spend,
  non-blocking emails). Repeat "Add notification" per threshold.
- **Hard cap (deliberately skipped):** Console → **Settings → Limits → Spend limits → "Change
  Limit"** is a *hard cap that pauses the API*. **Leave it unset** — a $25 cap makes no sense below
  the $20 in-app kill-switch, which is the authoritative bound.

> ⚠️ **Workspace caveat — may need a key rotation. Decision for you.** Dollar-threshold notifications
> attach **only** to a **named Workspace**, not the Default Workspace. If the app's
> `ANTHROPIC_API_KEY` lives in the Default Workspace, you'd have to **create a dedicated Workspace,
> mint a new key there, and re-run `supabase secrets set ANTHROPIC_API_KEY=…`** (keys can't move
> between workspaces). If that's more hassle than it's worth, the fallback is fine: rely on the **$20
> in-app kill-switch** + periodic manual checks at **Settings → Usage / Cost** (view-only). The
> planner's own guardrails already bound spend; these alerts are insurance, not load-bearing.

### Supabase — Free tier can't bill you (nothing to configure)

"You will not be charged while using the Free Plan" — no payment method, no overage billing; hitting
a limit makes the project **read-only / paused**, never a charge. There is **no $-threshold alert**
feature (Spend Cap is an org-level, **Pro-only** setting, effectively $0 on Free). Monitor manually
at **Dashboard → [org] → Usage**. The keep-alive cron prevents the inactivity pause; the free-tier
limits are the only "cap", and they pause rather than bill.

### Vercel — Hobby can't bill you either (confirm default alerts)

Hobby is free with **no overage billing** — exceed an included limit and the resource **pauses**
(wait out the window), never an invoice. Spend Management (dollar caps, %/SMS alerts) is **Pro-only**.
On Hobby, just confirm the default usage emails are on: **Dashboard → [team] → Settings → My
Notifications → Usage group** ("Usage increased" + "Usage limit reached"), **Web + Email = on**. See
consumption at **Dashboard → Usage**. (Out-of-band charges like domain renewals are purchases, not
compute overage.)

---

## Security incident runbook

When a Dependabot / secret-scanning / Sentry alert fires:
1. Assess severity.
2. Let Dependabot open the fix PR (or Claude bumps it); CI runs the full gate.
3. Review → merge → deploy.
4. **If a key leak is suspected, rotate the affected key immediately** at its provider dashboard,
   then update the corresponding env var / Actions secret.
