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

## Not yet provisioned

Added in later stages; documented here when they are:

- **Supabase** (Stage 1) — Postgres, Auth, RLS, Realtime, Edge Functions. anon + service-role keys.
- **Vercel** (Stage 1) — frontend hosting + PR previews.
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
