# ADR-0022 — CI-driven prod deploy: migrations + Edge Functions on merge to main

**Date:** 2026-07-02 · **Stage:** 6

The hand-run `supabase db push` (the ADR-0006 bootstrap exception) and `supabase functions deploy`
(deferred here by ADR-0015) become automated. `.github/workflows/deploy.yml` deploys to the ONE
production project after every green CI on `main`.

- **Trigger = CI success on `main`, not a raw push.** `workflow_run` on the `CI` workflow
  `completed` + a `gate` job that proceeds only when `conclusion == 'success'` (or a
  `workflow_dispatch` **from main**). Prod changes only after lint/types/tests/secret-scan pass on
  the exact merged commit; a semantic-merge conflict that reddens main's CI blocks the deploy.
  `branches: [main]` filters on the CI run's `head_branch` — for a `pull_request` run that is the
  PR **source** branch, so PR-branch CI never triggers a deploy; only the push-to-main CI run
  (`head_branch == main`) matches. Downstream jobs check out `workflow_run.head_sha` (the commit CI
  validated), not `github.sha` (which is main's tip for a `workflow_run` event).
- **Sequential, fail-closed.** `migrate` → `deploy-functions` (`needs:`). A failed `db push` fails
  migrate and **skips** the function deploy — functions never ship against a half-applied schema.
  No `if: always()` / `continue-on-error` anywhere downstream (either would re-enable deploys after
  a failed migration or failed CI).
- **Migrations via the session pooler.** `supabase db push --db-url "$SUPABASE_DB_URL"` where that
  env var is fed from the **reused `BACKUP_DATABASE_URL`** secret — the IPv4 **session-pooler** string
  the backup job already uses (migrations write, backups read, but the free pooler forces the same
  `postgres` user, so one secret serves both; the direct `db.<ref>` host is IPv6-only, unreachable
  from GitHub runners — the backup lesson). `yes |` forces
  non-interactive (`db push` has no `--yes` and can hang on a `[Y/n]` prompt, supabase/cli#2238).
  Idempotent — applies only migrations absent from `schema_migrations`; prod already recorded all 8
  from the bootstrap, so the first automated run is a clean no-op. A `--dry-run` step logs pending
  migrations for audit (non-fatal).
- **Functions deployed with `verify_jwt = false`** (`supabase/config.toml` per-function + a
  belt-and-suspenders `--no-verify-jwt` on deploy). The platform gateway's JWT check 401s the
  unauthenticated CORS **OPTIONS preflight** before the function runs, which breaks every in-app AI
  call. The functions already verify the caller's JWT themselves (`_shared/auth.ts`) and handle
  OPTIONS (`_shared/cors.ts`), so the gateway check is redundant **and** harmful — turning it off
  moves the identical check inside the function (no security loss; RLS still isolates data
  independently). `--use-api` bundles server-side (no Docker → removes a CI failure class). A
  post-deploy smoke asserts an unauthenticated POST to `ai-status` returns **401** (deployed +
  reachable + own-auth enforced); a 404/000/5xx fails the deploy.
- **Careful-gating extras.** `concurrency: prod-deploy` (serialize; never `cancel-in-progress` a
  live `db push`) + per-job `timeout-minutes` so a hung run can't hold the lock (and a stuck
  migration aborts, releasing its DB lock); a `github.ref == main` guard on dispatch closes the
  "deploy any branch via `gh workflow run --ref <x>`" hole; least-privilege `permissions:
  contents: read` (Supabase auth is via secrets, not `GITHUB_TOKEN`).
- **Prereqs (human, one-time).** The only new Actions secret is **`SUPABASE_ACCESS_TOKEN`** (function
  deploy) — the migrate job reuses the existing `BACKUP_DATABASE_URL`, and `SUPABASE_PROJECT_REF`
  (variable) is already set. Plus **`ANTHROPIC_API_KEY` + `ALLOWED_ORIGIN=https://<prod-domain>`** set
  as Function Secrets via `supabase secrets set` (or the deployed functions 500 / CORS-block at
  runtime — the smoke can't see these). Each job preflight-**skips green** until its secrets exist.
- **Rollback is not `git revert`.** Supabase never auto-runs `down` migrations; reverting a
  migration file only stops it re-applying. Roll back a schema change by running that migration's
  hand-written `-- down:` block via `psql "$SESSION_POOLER_URL"`, then deleting its
  `schema_migrations` row — or restore the daily encrypted backup for a data-lossy change (take an
  on-demand backup **before** a risky migration). `vercel rollback` reverts the frontend.
- **Deferred / accepted tradeoffs.** No path-filtering — every green main CI redeploys all three
  functions (safe version churn, not downtime; `workflow_run` can't use native `paths` filters and a
  git-diff gate wasn't worth the v1 complexity). No Supabase-in-CI schema validation (ADR-0011
  stands) — a *semantically* wrong-but-applies migration isn't caught automatically; mitigations are
  local `supabase db reset` before the PR + the `--dry-run` audit + the daily backup. A
  migration-safety lint (block unmarked `drop`/`truncate`) and an `environment: production`
  required-reviewer are noted as future hardening.

**Verified:** `deploy.yml` parses (YAML); `config.toml` valid TOML; CLI flags (`setup-cli@v2`,
`db push --db-url`/`--dry-run`, `functions deploy --use-api --no-verify-jwt`) confirmed against CLI
v2.107 via a three-lens adversarial review (Supabase-CLI correctness, GitHub-Actions semantics,
prod-safety) whose findings are folded in above. First live run is gated behind the human prereqs.
