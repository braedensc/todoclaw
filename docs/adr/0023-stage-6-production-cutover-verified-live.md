# ADR-0023 — Stage 6 production cutover: verified live + external billing posture

**Date:** 2026-07-02 · **Stage:** 6

The finishing stage. Most of Stage 6 was pulled forward "skeleton-first" (encrypted backups → ADR-0006,
Sentry code → ADR-0009, CI gate → ADR-0010, keep-alive cron, security headers/CSP → ADR-0006); this
entry records the last mile — the deploy pipeline proven in prod, the smoke, and the cost posture.

**Deploy pipeline proven end-to-end (ADR-0022).** Merging #43 auto-triggered `deploy.yml` via
`workflow_run` on the green push-to-main CI — no manual dispatch. The migrate job was an idempotent
no-op (schema bootstrapped earlier), and all three Edge Functions (`ai-status` / `plan-my-day` /
`ai-chat`) deployed to the prod project. **The prior "functions list is empty" gap is closed.**

**Prod smoke (2026-07-02) — passed.** Against the deployed `ai-status`: allowed-origin OPTIONS → `204`
echoing `access-control-allow-origin: https://todoclaw-psi.vercel.app`; a disallowed origin → `204`
with **no** ACAO header (browser blocks); unauth `POST` → `401` (own-auth enforced under the gateway
`verify_jwt=false`); the app root → `200` HTML. This **resolves the ADR-0015 CORS caveat** — the
origin-lock, unverifiable under local `functions serve` (permissive `*`), is confirmed on the real
deployment. The one **live model call** (a single Plan My Day, ≈2¢) is left for the owner to fire from
the signed-in app — it doubles as the sign-in-renders check.

**Billing/cost posture (the "billing alerts" gap).** Research (3-provider sweep) surfaced that **only
Anthropic bills per use** on the owner's key; **Supabase Free and Vercel Hobby cannot charge** — they
pause the resource at a free-tier limit, never invoice. So budget risk is Anthropic-only and already
bounded by the in-app **$20/month kill-switch** (ADR-0015). External alerts (SERVICES.md → *Billing &
cost alerts*): Anthropic Console **email alerts at $10 / $15** (Workspace → Limits → Add notification),
**no** $25 hard cap (it would sit below the kill-switch — pointless). **Caveat:** those notifications
require a *named* Workspace; if the key is in the Default Workspace, enabling them means a new Workspace
+ key rotation — an owner call, since the kill-switch already bounds spend. Supabase/Vercel need only a
confirm of default free-tier usage notifications.

**Deferred (deliberately).** Backup least-privilege (`backup_ro` via a static-IP/self-hosted runner or
the Supabase IPv4 add-on — ADR-0006) stays future hardening, not worth the cost for a 2-person app.
`deploy.yml` redeploys all three functions on every main merge (idempotent, harmless); path-filtering
to functions-only changes is a cheap future optimization. A migration-safety lint and an
`environment: production` required-reviewer (ADR-0022) remain noted-but-unbuilt.

**Verified.** Deploy run `success`; the four smoke checks above; `docs/SERVICES.md` billing + smoke
records updated in the same PR.
