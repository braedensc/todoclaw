# ADR-0031 — Proactive daily messaging + end-of-day chat (Web Push)

**Date:** 2026-07-07 · **Stage:** post-launch (notifications)

## Context

EisenClaw's two most-loved Telegram behaviors were a **morning "plan my day" nudge** and an
**end-of-day recap**, each of which opened a two-way chat to adjust todos. Todoclaw already has the AI
generation (`plan-my-day`, `ai-chat`) and an in-app chat (BabyClaw), but nothing **proactive**: the
app can only speak when the user opens it. This ADR records the architecture for the whole proactive
stack — scheduling, per-user timing, system-context AI spend, idempotent delivery, Web Push transport,
and the in-app two-way loop — and the result of the transport spike (the riskiest piece).

Three invariants shape every choice: it is **opt-in / default-off** (a higher bar than user-initiated
AI, ADR-0015); it **works without AI** (a paused budget degrades to a deterministic message, never a
missed send that breaks); and background AI stays **inside the existing budgets** (the `$20/mo` global
+ `$10/mo` per-user caps still bind, now via a system code path).

## Decision

Ship it in the sequence below (one branch = one PR). The moving parts:

- **Scheduler — GitHub Actions hourly cron.** `notify.yml` (`0 * * * *`) POSTs to a new
  `dispatch-messages` Edge Function with a `DISPATCH_SECRET` header. This matches the repo grain
  (keepalive/backup/deploy are all cron→edge-fn-with-secret); no pg_cron/Vault. Hour-granular timing
  is fine because the in-app inbox covers any miss (see Durability).
- **Per-user local time.** The dispatcher derives each user's local hour from `user_schedule.timezone`
  via `Intl.DateTimeFormat` and matches it against explicit integer `morningHour` / `eveningHour`
  prefs (not freeform wake/bed strings) to decide who is due this hour.
- **System auth — reuse the existing fenced service-role client (`_shared/admin.ts`).** The cron has no
  user JWT, and the guardrail RPCs raise `not_authenticated` when `auth.uid()` is null. So
  `dispatch-messages` uses `adminClient()` — the single service-role client ADR-0030 already
  introduced for `redeem-invite` — to call `*_for_user(p_user_id, …)` SECURITY DEFINER RPCs (granted to
  `service_role` only). It becomes `admin.ts`'s **second** fenced caller; no new service-role surface —
  see Why this shape.
- **Idempotency — the message row is the claim.** A `messages` table with `unique(user_id, local_date,
  kind)` and a claim RPC doing `insert … on conflict do nothing returning id`. AI + push happen **only
  if a row was inserted**, so an overlapping/retried cron never double-sends.
- **Delivery — Web Push (RFC 8291), from scratch on WebCrypto.** `_shared/web-push.ts` does the
  aes128gcm content encryption (RFC 8188) + VAPID ES256 auth (RFC 8292) with zero new dependencies.
  The SW shows the notification; a `notificationclick` deep-links into the app.
- **Two-way reply — in-app, not in the notification.** Tapping the push opens `#/chat/<messageId>`,
  seeding the existing `ChatPanel` with the message so the user can discuss/adjust todos — reusing
  `ai-chat`, no new AI surface.
- **Consent — explicit opt-in, default off.** Requires the browser Notification permission **and**
  `config.notifications.enabled`, plus quiet hours. Off ⇒ the user is simply never "due."
- **Durability — `messages` is the source of truth.** It backs an in-app inbox + unread badge; push is
  best-effort on top. Realtime stays deferred (ADR-0021); the inbox reads via TanStack Query on
  load/focus.

### Spike outcome (this PR)

`_shared/web-push.ts` is implemented and **pinned to the published RFC test vectors** in
`web-push.test.ts`: RFC 8188 §3.1 (content-encoding key/nonce/body), RFC 8291 §5 (ECDH → key-combine →
CEK/NONCE → full encrypted body, byte-identical), and a VAPID JWT round-trip (ES256 signature verifies,
claims correct). All green under `deno test`; `deno check` is clean. The transport — the one piece that
could have silently failed on a real phone — is de-risked before anything is built on top of it.

## Why this shape

- **Cron over pg_cron/Vault.** Fits the repo's existing scheduled-work pattern and needs no new DB
  extensions or secret store. The cost is hour granularity; the inbox absorbs it. If tighter timing is
  ever wanted, `pg_cron` + `pg_net` calling the same function is the documented upgrade.
- **Service-role client — an established pattern, not a new seal.** The cron must act across users with
  no JWT; that requires a system credential. The alternatives fail: _anon client + DEFINER RPCs_ would
  force those RPCs to be granted to `public`, making them callable by anyone with the (public) anon key
  — the `DISPATCH_SECRET` only gates the HTTP function, not direct PostgREST; _pg_cron_ can't originate
  the Anthropic call for a plan. **ADR-0030 already answered this**: it introduced the one service-role
  client (`_shared/admin.ts`) for `redeem-invite`, plus the `revoke all from public` / `grant execute
  to service_role` DEFINER-RPC pattern that keeps sensitive logic off the public PostgREST surface.
  `dispatch-messages` reuses `adminClient()` verbatim and adds its `*_for_user` guardrail RPCs under the
  same fencing — a second symmetric caller, not a new capability. `SUPABASE_SERVICE_ROLE_KEY` is
  auto-injected into every function's env already (never a managed secret, never bundled), so this adds
  *code that uses* the key, not the key's presence. ADR-0015's real threat — **prompt injection via
  BabyClaw** — cannot reach it: injection changes model output, not code paths; the tool registry is
  fixed code, and `admin.ts` is imported only by `redeem-invite` and `dispatch-messages`, never by
  `ai-chat`/`plan-my-day`. The "no service-role client in the request/AI path" property is preserved,
  and spend stays attributed per user under the same caps via the `*_for_user` RPCs.
- **From-scratch Web Push over a library.** The Edge tree carries only three deps. Node-`crypto`-based
  `web-push` doesn't run on Deno; a WebCrypto jsr lib (`@negrel/webpush`) would work but adds a
  supply-chain surface for ~200 lines we can pin to the RFC ourselves. Doing it in-house means every
  crypto step has an RFC vector guarding it.
- **The row insert as the idempotency primitive.** No separate "sent" status to read-then-write (which
  races). The unique constraint + `on conflict do nothing returning id` makes "claim the send" a single
  atomic step; spend follows the claim.

## Consequences / tunables

- **Timing is hour-granular.** A user whose local morning hour the cron misses (clock skew, a skipped
  run) sees the message in the inbox on next open; they are not silently dropped.
- **Budget under the system path.** `dispatch-messages` runs `precheckForUser` / `recordUsageForUser`
  against the same `$20`/`$10` ledgers plus a system rate limit, so proactive AI can never exceed
  interactive AI's budget. When AI is paused, the morning/evening message degrades to a deterministic,
  non-AI body (built from `daily_state` completions) so the send still happens.
- **iOS needs an installed PWA** to receive Web Push; the Settings UI shows an install hint on iOS
  Safari when not installed. Desktop + Android work in-browser after permission.
- **Consent is deliberately higher-friction** than ADR-0015's trusted-user AI: permission prompt +
  explicit toggle + quiet hours. There is no "on by default."
- **Realtime remains deferred** (ADR-0021); the inbox is pull-based. If proactive volume ever grows,
  re-enabling Realtime for `messages` is a localized change.
- **Secrets to provision** (owner, one-time): `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`
  + `DISPATCH_SECRET` as Edge secrets; `VITE_VAPID_PUBLIC_KEY` in Vercel; `DISPATCH_URL` /
  `DISPATCH_SECRET` in GitHub Actions. `generateVapidKeys()` in `web-push.ts` produces the key pair.
  `dispatch-messages` must also be added to `deploy.yml`'s hardcoded function list or it never ships.

**Down path:** remove `notify.yml`, `dispatch-messages`, `_shared/{web-push,guardrails-system,
run-recap}.ts`, the `*_for_user` RPCs, and the `messages` / `push_subscriptions` tables (drop
migrations). Leave `admin.ts` (shared with `redeem-invite`; just drop `dispatch-messages` from its
fence comment). Frontend: drop the PWA plugin, `sw.ts`, the notifications feature, and the
`#/chat/<id>` route. No user data depends on it; disabling the cron alone fully halts the feature.
