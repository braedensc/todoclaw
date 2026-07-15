# ARCHITECTURE.md

A running decision log (ADR-style): every significant technical and design choice with the *why*, the alternatives rejected, and the date. Append-only.

> Stage 0 decisions are captured in CLAUDE.md "Key Design Decisions". ADR entries below begin in Stage 1.

---

## How to add an ADR (per-file, collision-proof)

Each ADR is its own file under `docs/adr/`. **New ADRs use date+slug names —
`docs/adr/YYYY-MM-DD-short-slug.md` — with NO sequence number.** There is no shared
counter to claim and no common file tail to append to, so parallel sessions can add
ADRs with zero coordination (the old numbered scheme collided three times during the
Stage 5/6 parallel build). Historical ADRs keep their `NNNN-` names — every existing
`ADR-00XX` reference below still resolves. After adding a file, add one row to this
index.

## Index

| ADR | Date | Decision |
|---|---|---|
| [ADR-0001](adr/0001-frontend-toolchain-vite-react-18-typescript.md) | 2026-06-23 | Frontend toolchain: Vite + React 18 + TypeScript (strict) + Tailwind 3 |
| [ADR-0002](adr/0002-typescript-projectreference-layout-solution-app-node.md) | 2026-06-23 | TypeScript project-reference layout (solution + app + node) |
| [ADR-0003](adr/0003-envvar-strategy-anon-key-clientside-servicerole.md) | 2026-06-23 | Env-var strategy: anon key client-side, service-role server-only |
| [ADR-0004](adr/0004-drag-drop-raw-pointer-events-spike.md) | 2026-06-23 | Drag/drop = raw Pointer Events (spike resolved) |
| [ADR-0005](adr/0005-no-client-harddelete-softdelete-rls-denybydefault.md) | 2026-06-23 | No client hard-delete: soft-delete + RLS deny-by-default |
| [ADR-0006](adr/0006-production-topology-encrypted-backups.md) | 2026-06-23 | Production topology + encrypted backups |
| [ADR-0007](adr/0007-stage-2-schema-habits-dailystate-userschedule.md) | 2026-06-23 | Stage 2 schema: habits, daily_state, user_schedule (+ RLS, shared Zod types) |
| [ADR-0008](adr/0008-dev-tooling-eslint-flat-prettier-vitest.md) | 2026-06-23 | Dev tooling: ESLint (flat) + Prettier + Vitest + React Testing Library |
| [ADR-0009](adr/0009-observability-sentry-dev-mode-react-error.md) | 2026-06-23 | Observability: Sentry (dev mode) + React error boundaries + Sentry MCP |
| [ADR-0010](adr/0010-ci-quality-gate-branch-protection-the.md) | 2026-06-23 | CI quality gate + branch protection (the merge-then-require ordering) |
| [ADR-0011](adr/0011-e2e-playwright-smoke-in-ci-full.md) | 2026-06-23 | E2E: Playwright smoke in CI; full DB-backed E2E stays local |
| [ADR-0012](adr/0012-history-table-denormalized-snapshot-appendonly-reconciled.md) | 2026-06-24 | `history` table: denormalized snapshot + append-only (reconciled with soft-delete) |
| [ADR-0013](adr/0013-keep-dailystate-jsonb-maps-write-them.md) | 2026-06-24 | Keep `daily_state` jsonb maps; write them via atomic `SECURITY INVOKER` merge RPCs |
| [ADR-0014](adr/0014-inviteonly-access-private-mvp-on-the.md) | 2026-06-24 | Invite-only access (private MVP on the owner's key) |
| [ADR-0015](adr/0015-ownerkey-ai-architecture-ratelimit-budget-guardrails.md) | 2026-06-24 | Owner-key AI architecture + rate-limit/budget guardrails |
| [ADR-0016](adr/0016-plan-my-day-client-payload-serverread.md) | 2026-06-24 | Plan My Day: client payload + server-read schedule, structured output via forced tool use |
| [ADR-0017](adr/0017-streaming-chat-manual-tool-loop-clientheld.md) | 2026-06-25 | Streaming chat: manual tool loop, client-held history, confirm-before-destructive |
| [ADR-0018](adr/0018-goldenpath-e2e-harness-dbbacked-local-suite.md) | 2026-06-25 | Golden-path E2E harness: DB-backed local suite, mocked AI, CI stays smoke-only |
| [ADR-0019](adr/0019-visual-urgency-purelib-style-tiers-global.md) | 2026-07-02 | Visual urgency: pure-lib style tiers + global keyframe (Stage 5 PR1) |
| [ADR-0020](adr/0020-responsive-layout-one-720px-breakpoint-bottom.md) | 2026-07-02 | Responsive layout: one 720px breakpoint, bottom tab bar on mobile (Stage 5 PR2) |
| [ADR-0021](adr/0021-realtime-redeferred-past-stage-5.md) | 2026-07-02 | Realtime re-deferred past Stage 5 |
| [ADR-0022](adr/0022-cidriven-prod-deploy-migrations-edge-functions.md) | 2026-07-02 | CI-driven prod deploy: migrations + Edge Functions on merge to main |
| [ADR-0023](adr/0023-stage-6-production-cutover-verified-live.md) | 2026-07-02 | Stage 6 production cutover: verified live + external billing posture |
| [ADR-0024](adr/0024-backup-restore-indb-snapshots-invoker-rpcs.md) | 2026-07-02 | Backup/restore: in-DB snapshots + INVOKER RPCs + JSON export (Stage 5 PR3) |
| [ADR-0025](adr/0025-mobile-matrix-overview-focus-reinterpretation.md) | 2026-07-06 | Mobile matrix: quadrant overview → focus view reinterpretation |
| [ADR-0026](adr/0026-mobile-chrome-slim-topbar-bottom-nav.md) | 2026-07-06 | Mobile chrome: slim top bar + thumb-zone bottom nav (Concept D) |
| [ADR-0027](adr/0027-done-reminders-full-pages-hash-router.md) | 2026-07-06 | Done & Daily reminders as full pages via a minimal hash router |
| [ADR-0028](adr/0028-mobile-list-only-no-grid-single-add-sheet.md) | 2026-07-06 | Mobile is list-only: remove the grid, single bottom-bar add sheet |
| [ADR-0029](adr/0029-per-user-ai-spend-alert-owner-webhook.md) | 2026-07-07 | Per-user AI spend alert: owner webhook on threshold crossing |
| [ADR-0030](adr/0030-self-service-invite-codes.md) | 2026-07-07 | Self-service invite codes: text a link to onboard users |
| [ADR-0031](adr/0031-proactive-daily-messaging-web-push.md) | 2026-07-07 | Proactive daily messaging + end-of-day chat via Web Push (opt-in) |
| [ADR 2026-07-08](adr/2026-07-08-due-dates-wall-clock.md) | 2026-07-08 | Due dates are wall-clock: floating `date` + optional local `time` (completes #178) |
| [ADR 2026-07-09](adr/2026-07-09-task-reminders-pg-cron-push.md) | 2026-07-09 | Per-task reminders: materialized fire times + pg_cron minute sweep → Web Push |
| [ADR 2026-07-13](adr/2026-07-13-persistent-chats.md) | 2026-07-13 | Persistent BabyClaw chats: server-authoritative history via a service-role write path |
| [ADR 2026-07-13](adr/2026-07-13-babyclaw-budget-invite-hardening.md) | 2026-07-13 | BabyClaw budget + invite hardening |
| [ADR 2026-07-14](adr/2026-07-14-encrypt-content-at-rest.md) | 2026-07-14 | At-rest encryption of chat / inbox / daily-plan content (pgcrypto + Vault key) |
