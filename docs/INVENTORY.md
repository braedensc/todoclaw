# INVENTORY.md — Stack, Accounts & Secrets Tracker

A single **at-a-glance** map of the whole TodoClaw stack: every technology, every account, every
environment variable / secret **by name**, where each one lives, and the automated processes that
tie them together. It's the "single pane of glass" for an audit, a key rotation, or onboarding a new
environment.

**Scope:** names and locations only — **no secret _values_ ever live here** (or anywhere in git).
Real values live in the dashboards / secret stores listed below; local ones live in `.env.local`
(gitignored). This doc is the index; [`SERVICES.md`](SERVICES.md) is the narrative reference with
the _why_, provisioning steps, and runbooks. When they disagree, treat this as the roster and
SERVICES.md as the detail — and fix whichever is stale in the same PR.

> Nothing here is a secret: it's variable **names**, public identifiers (project ref, public URLs),
> and pointers to where the real values are kept. That's the whole point of the "no values" rule.

---

## 1. Production coordinates

| Thing | Value | Notes |
|---|---|---|
| Frontend (prod) | `https://todoclaw-psi.vercel.app` | Vercel Hobby, default `*.vercel.app` subdomain |
| Backend (prod) | `https://hknmhkzumkjhylxclrcy.supabase.co` | Supabase project ref `hknmhkzumkjhylxclrcy` |
| Repo | `github.com/braedensc/todoclaw` | public |
| Custom domain | _none yet_ | served on provider subdomains; a custom domain would touch a registrar + `ALLOWED_ORIGIN` |
| Local dev backend | `http://127.0.0.1:54321` (API), `:54323` (Studio), `:54324` (Mailpit) | `supabase start` (Docker) |

---

## 2. Services & accounts

Everything the app depends on across the stack. Dashboards are where you'd rotate a key or check
usage. Billing posture: **only Anthropic can actually charge you** — Supabase Free and Vercel Hobby
_pause_ a resource at the limit instead of billing (§5).

| Service | What it does for TodoClaw | Account / login | Dashboard | Tier |
|---|---|---|---|---|
| **GitHub** | Source repo, CI (Actions), branch protection, secret scanning, Dependabot | `braedensc` (`gh` CLI: `repo, workflow, read:org, gist`) | [repo](https://github.com/braedensc/todoclaw) | Public repo → free Actions + security scanning |
| **Supabase** | Entire backend: Postgres, Auth, RLS, Realtime, Edge Functions (Deno) | owner account | [project](https://supabase.com/dashboard/project/hknmhkzumkjhylxclrcy) | Free (pauses, never bills) |
| **Vercel** | Hosts + deploys the frontend; sets security headers/CSP | owner account (GitHub OAuth) | [dashboard](https://vercel.com/dashboard) | Hobby (pauses, never bills) |
| **Anthropic** | Plan My Day + BabyClaw chat (server-side only, owner's key) | owner account | [console](https://console.anthropic.com) | **Pay-per-use — the only billable service.** Bounded by in-app $20/mo kill-switch |
| **Sentry** | Frontend error monitoring (DSN-gated; off unless configured) | owner account | [sentry.io](https://sentry.io) | Free/developer; MCP registered user-scoped |
| **Web Push (VAPID)** | Opt-in morning/evening push notifications | no account — self-generated VAPID keypair | browser push services (Apple/Google/Mozilla) | Free, no account/billing |
| **npm registry** | Frontend + tooling packages | none (public) | [npmjs.com](https://www.npmjs.com) | Free public |
| **JSR** | Deno std-lib modules for Edge Functions | none (public) | [jsr.io](https://jsr.io) | Free public |
| **Docker / Docker Hub** | Runs the local Supabase stack; backup job's `postgres:17-alpine` image | Docker Desktop (local) | [hub.docker.com](https://hub.docker.com) | Free (anon pull limits) |
| **Email / SMTP** | Auth email (confirm / reset / dashboard invite) | Supabase built-in default sender | via Supabase Auth | ⚠️ built-in is heavily rate-limited; a real SMTP provider is a future upgrade if volume grows |

**Not currently provisioned (flagged for the future):** a custom domain/registrar; a dedicated
transactional-email provider (SendGrid/Postmark/Resend); Cloudflare Turnstile CAPTCHA (only relevant
if public sign-up is ever opened — it isn't).

---

## 3. Secrets & configuration variables

The master roster of all 31 variables, grouped by **where each is stored**. "Kind" is
**secret** (never expose) vs **public/config** (safe to ship — RLS + server-side gates are the real
guards). Values live only in the store named; this table is names + purpose.

### Store legend
| Store | Where you set it |
|---|---|
| `Vercel env` | Vercel → Project → Settings → Environment Variables (baked into the frontend build) |
| `.env.local` | local dev only, gitignored (mirror of the `Vercel env` values, local Supabase) |
| `Supabase secret` | `supabase secrets set …` on the prod project (Edge Functions) — **never in CI/repo** |
| `GH secret` / `GH var` | GitHub → Settings → Secrets and variables → Actions |
| `platform` | auto-injected into every Edge Function by Supabase (you never set these) |
| `build` | auto-injected by Vercel at build time (you never set these) |

### 3a. Frontend — `Vercel env` + `.env.local` (all public; every `VITE_*` ships in the bundle)
| Variable | Kind | Service | Purpose / notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | public | Supabase | Project URL the SPA talks to. = `SUPABASE_URL` (different name) |
| `VITE_SUPABASE_ANON_KEY` | public | Supabase | Anon API key; RLS is the real guard. = `SUPABASE_ANON_KEY` |
| `VITE_SENTRY_DSN` | public | Sentry | Ingest DSN (a public URL). Unset ⇒ Sentry off (app no-ops) |
| `VITE_VAPID_PUBLIC_KEY` | public | Web Push | Public half of the VAPID pair. Unset ⇒ notifications "not configured" |

_No `VITE_OWNER_USER_ID`: the owner's identity is server-only. The frontend reveals the owner UI by asking the `admin` Edge Function's `whoami` action, so the owner's user id never ships in the bundle._

### 3b. Build-time — Vercel-injected (public)
| Variable | Kind | Service | Purpose / notes |
|---|---|---|---|
| `VERCEL_GIT_COMMIT_SHA` | public | Vercel | → Sentry `release` tag (baked as `__GIT_COMMIT_SHA__`) |
| `VERCEL_ENV` | public | Vercel | → Sentry `environment` tag (production/preview) |

### 3c. Supabase Edge Function secrets — `supabase secrets set` (set once on the prod project)
| Variable | Kind | Service | Purpose / notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **secret** | Anthropic | The owner's AI key. Used by plan-my-day / ai-chat / dispatch-messages |
| `ALLOWED_ORIGIN` | public | Edge CORS | CORS allow-list (the prod origin). Defaults to `localhost:5173` when unset |
| `OWNER_USER_ID` | config (a user id) | app | **The real owner gate** for `generate-invite` + `admin` (incl. `whoami`). Unset ⇒ nobody is owner (safe) |
| `VAPID_PUBLIC_KEY` | public | Web Push | Public key (matches `VITE_VAPID_PUBLIC_KEY`) |
| `VAPID_PRIVATE_KEY` | **secret** | Web Push | Signs push messages. Unset ⇒ push skipped (inbox still persists) |
| `VAPID_SUBJECT` | public | Web Push | `mailto:` / URL identifying the push sender |
| `DISPATCH_SECRET` | **secret** | app | The **only** caller gate for `dispatch-messages`. Must equal the `GH secret` of the same name |
| `AI_SPEND_ALERT_WEBHOOK_URL` | **secret** | Slack/Discord/relay | One-off POST when a user crosses the spend alert threshold. Unset ⇒ no-op |

### 3d. Supabase platform-injected (you never set these)
| Variable | Kind | Purpose / notes |
|---|---|---|
| `SUPABASE_URL` | public | Same value as `VITE_SUPABASE_URL`; also a `GH var` for keep-alive |
| `SUPABASE_ANON_KEY` | public | Same value as `VITE_SUPABASE_ANON_KEY`; also a `GH secret` (for log masking) |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | RLS-bypass admin key. Fenced to `_shared/admin.ts`; never in frontend/CI. Has **no table DML** — all system access goes through `SECURITY DEFINER` RPCs |

### 3e. GitHub Actions — Secrets
| Variable | Kind | Used by | Purpose / notes |
|---|---|---|---|
| `BACKUP_DATABASE_URL` | **secret** | backup + deploy | Session-pooler Postgres DSN (contains DB password). Backup reads it; migrations reuse it |
| `BACKUP_GPG_PASSPHRASE` | **secret** | backup | AES-256 passphrase to encrypt the daily dump. **Lose it ⇒ backups undecryptable** |
| `SUPABASE_ACCESS_TOKEN` | **secret** | deploy | Supabase personal access token for the function-deploy Management API |
| `SUPABASE_ANON_KEY` | public value, stored as secret | keepalive | Prod anon key (secret only for log-masking hygiene) |
| `DISPATCH_SECRET` | **secret** | notify | Same value as the Supabase secret — the dispatcher's caller gate |

### 3f. GitHub Actions — Variables
| Variable | Kind | Used by | Purpose / notes |
|---|---|---|---|
| `SUPABASE_PROJECT_REF` | public | deploy | Prod ref `hknmhkzumkjhylxclrcy` — selects the project to deploy |
| `SUPABASE_URL` | public | keepalive | Prod project URL for the anti-pause ping |
| `DISPATCH_URL` | public | notify | `…/functions/v1/dispatch-messages` endpoint POSTed hourly |

### 3g. Local-dev / inactive (listed for completeness — not provisioned)
| Variable | Where | Status |
|---|---|---|
| `CI` | GitHub runner (auto) | toggles Playwright behavior; not user-set |
| `EISENCLAW_SEED_DIR` | local shell | optional path for the local-only EisenClaw seed script |
| `OPENAI_API_KEY` | `config.toml` (local Studio) | inert for the app — Supabase Studio's own assistant only |
| `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN` | `config.toml` template | **disabled** (SMS auth off) |
| `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` | `config.toml` template | **disabled** (Apple OAuth off) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_HOST` / `S3_REGION` | `config.toml` template | **disabled** (experimental OrioleDB storage unused) |

### One value, two names (don't double-count)
- `VITE_SUPABASE_URL` = `SUPABASE_URL` (platform + `GH var`)
- `VITE_SUPABASE_ANON_KEY` = `SUPABASE_ANON_KEY` (platform + `GH secret`)
- `VITE_VAPID_PUBLIC_KEY` = `VAPID_PUBLIC_KEY` (public half of the VAPID trio)
- `DISPATCH_SECRET` is the **one** value that must be set **identically** in two stores (`Supabase secret` + `GH secret`)
- `BACKUP_DATABASE_URL` is one secret used by two jobs (backup reads, deploy's migrate writes)

### The true secrets (rotate immediately if exposed)
`ANTHROPIC_API_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `VAPID_PRIVATE_KEY` · `DISPATCH_SECRET` ·
`AI_SPEND_ALERT_WEBHOOK_URL` · `BACKUP_DATABASE_URL` · `BACKUP_GPG_PASSPHRASE` ·
`SUPABASE_ACCESS_TOKEN`. Everything else is public/config by design.

---

## 4. Automated processes

### 4a. Scheduled jobs (all GitHub Actions cron, UTC — no `pg_cron`)
| When (UTC) | Workflow | Does | Config it needs |
|---|---|---|---|
| `17 8 * * *` daily | `keepalive.yml` | One REST ping so the free Supabase project never pauses (401/403 = healthy) | `SUPABASE_URL` (var) + `SUPABASE_ANON_KEY` (secret) |
| `0 9 * * *` daily | `backup.yml` | Encrypted `pg_dump` of `public` → AES-256 GPG artifact (90-day retention) | `BACKUP_DATABASE_URL` + `BACKUP_GPG_PASSPHRASE` (secrets) |
| `0 * * * *` hourly | `notify.yml` | POSTs `dispatch-messages`; the function picks who's due (local morning/evening, quiet-hours) and pushes | `DISPATCH_URL` (var) + `DISPATCH_SECRET` (secret) |

Every scheduled job **preflight-skips green** until its config is set (an unconfigured repo is never
red). Scheduled workflows run only from `main`.

### 4b. Event-driven pipelines
| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` ("CI") | push to `main`, every PR | Secret-scan + forbidden-paths, Lint, Typecheck, Test (each is a required check); E2E smoke + Hooks-change guard (not required) |
| `deploy.yml` ("Deploy (prod)") | after green CI on `main` | `migrate` (applies pending migrations via `db push`) → `deploy-functions` (deploys Edge Functions) |
| Vercel (native Git integration) | push to `main` / any branch | Prod deploy on merge; preview deploy per branch. **Not** a GitHub Action |

**Deploy notes**
- Edge Functions auto-deploy on merge, but the loop covers only `ai-status`, `plan-my-day`,
  `ai-chat`, `dispatch-messages`. **`generate-invite` and `redeem-invite` are NOT in the loop** —
  they need a manual `supabase functions deploy` when changed.
- Migrations: `supabase/migrations/*.sql`, applied to prod by the `migrate` job (idempotent
  `db push`). **No auto down-migrations** — rollback is a manual `-- down:` block via `psql` +
  removing the `schema_migrations` row; data-lossy changes restore from a backup. `vercel rollback`
  reverts the frontend independently.
- AI panels CORS-block on Vercel **preview** URLs by design (`ALLOWED_ORIGIN` locks to the single
  prod origin) so previews can't spend the Anthropic budget.

---

## 5. Cost & billing posture (quick)

| Service | Can it bill you? | Guardrail |
|---|---|---|
| **Anthropic** | **Yes — the only one** | In-app **$20/mo global kill-switch** + **$10/mo per-user** sub-cap + per-call clamp + rate limits (`_shared/guardrails.ts`). Console email alerts at $10/$15 are the backstop |
| Supabase | No (Free pauses/read-only at limits) | keep-alive cron prevents the ~7-day inactivity pause |
| Vercel | No (Hobby pauses at limits) | confirm default usage emails are on |
| GitHub / npm / JSR / Docker / Web Push | No | free tiers / no account |

---

## 6. "Where do I change X?" quick reference

| To change… | Go to |
|---|---|
| A frontend/public var (`VITE_*`) | Vercel env (prod) + your `.env.local` (local) |
| A server secret (Anthropic key, VAPID, dispatch, owner id, webhook) | `supabase secrets set …` on the prod project |
| A CI/backup/deploy secret or variable | GitHub → Settings → Secrets and variables → Actions |
| AI budget caps / rate limits / model | code constants in `supabase/functions/_shared/guardrails.ts` + `_shared/anthropic.ts` → **needs a deploy** (the $0.20 per-call ceiling is _also_ hardcoded in two SQL migrations — change both) |
| Auth policy (signups off, email confirm, redirect URLs) | Supabase → Authentication |
| Security response headers / CSP | `vercel.json` |
| Who is "owner" | `OWNER_USER_ID` (Supabase secret) — the gate for `generate-invite` + `admin`. The frontend reveals the owner UI via the `admin` `whoami` action, so no owner id ships to the client |

---

## Keeping this current

Update this file whenever you **add or remove a service, an account, or an env var/secret** — same
PR as the change. Keep it table-first and value-free; push any new prose/runbook detail into
[`SERVICES.md`](SERVICES.md) and link to it. If a row here ever contradicts SERVICES.md, one of them
is stale — reconcile both.
