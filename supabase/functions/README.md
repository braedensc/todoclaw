# Edge Functions (Deno)

Server-side AI for Todoclaw. **The Anthropic key never leaves the server** — all model calls
run here, never in the frontend bundle (CLAUDE.md Hard Rule; ADR-0015). Deno 2 runtime
(`supabase/config.toml` → `[edge_runtime]`).

## Layout

```
_shared/        # shared modules (imported by each function via ../_shared/*.ts)
  cors.ts        # origin allow-list (ALLOWED_ORIGIN), preflight — never '*'
  auth.ts        # caller-JWT-scoped Supabase client (RLS applies; no service-role here)
  admin.ts       # the ONE service-role client (ADR-0030) — used only by redeem-invite (createUser)
  invite-code.ts # high-entropy Crockford-base32 invite-code generator + redeem URL
  anthropic.ts   # Anthropic SDK client factory + MODEL/MAX_TOKENS (owner key from env)
  guardrails.ts  # per-user rate limits + global budget kill-switch + cost math
  weather.ts     # wttr.in summary, cached ~30min via weather_cache (DEFINER get/put)
  plan-prompt.ts # Plan My Day prompt builder + emit_plan tool (structured output)
  plan-inputs.ts # server-side buildPlanRequest (task/habit selection + date math, ported from src/lib)
  run-plan.ts    # in-process Plan My Day path (own plan_my_day gate); injected into BabyClaw's generate_plan
  placement.ts   # due-date → x/y/staged auto-placement table (Discrepancy #5)
  capabilities/  # BabyClaw's transport-agnostic capability registry (~20 tools) — see its README
  chat-tools.ts  # thin ANTHROPIC ADAPTER over the registry (TOOL_DEFS + executeTool + confirm summary)
  chat-prompt.ts # BabyClaw persona + security rules + grid primer; renders the live context
  chat-context.ts# loads the per-request context (tasks + habits + today's completion + schedule + config)
  sse.ts         # Server-Sent Events encoder for the streaming chat
  dates.ts       # localDateInTZ port (for user-local date math)
  *.test.ts      # deno unit tests for the pure logic (cors, cost, prompt, placement, registry, dates)
ai-status/       # PR2 proof endpoint: returns the caller's budget/rate-limit state (no model call)
plan-my-day/     # PR3: schedule + weather-aware daily plan (forced emit_plan tool → structured JSON)
ai-chat/         # BabyClaw: streaming chat over the capability registry; confirm before destructive ops (ADR-0017)
generate-invite/ # OWNER-ONLY: mint a redeemable invite code + shareable link (ADR-0030)
redeem-invite/   # PUBLIC: redeem a code → create the account via service-role admin.createUser (ADR-0030)
dispatch-messages/ # CRON (notify.yml): proactive daily plan/recap push; DISPATCH_SECRET-gated (ADR-0031)
```

BabyClaw's tool surface lives in `_shared/capabilities/` (a registry meant to be reused by a future
MCP server, deferred); `chat-tools.ts` is just the Anthropic adapter. See `capabilities/README.md`
for the layer + the threat model.

## Guardrails (protect the owner's key — ADR-0015)

Backed by `supabase/migrations/20260624010000_ai_usage_and_budget.sql`:

- **Per-user rate limits** — `ai_usage` (append-only) + `ai_usage_check_and_record` (SECURITY
  INVOKER; counts the caller's trailing-hour/day rows, raises when over). Balanced tier: chat
  30/hour + 100/day, plan_my_day 10/day.
- **Global monthly budget kill-switch** — `ai_budget_ledger` (one row per `YYYY-MM`, **no
  grants/policies** → unreachable by app roles) read/written only by `ai_budget_check` /
  `ai_budget_add` (SECURITY DEFINER). $20/month cap; when tripped, every AI endpoint refuses.
  This keeps the **service-role key out of the functions entirely** — the ledger is reached via
  these RPCs under the caller's JWT, never an admin client.
- **Per-user spend cap + owner alert** — a per-user monthly sub-cap (`ai_user_budget_ledger`,
  `$10`, ADR from the 2026-07-06 audit) BLOCKS one account from draining the shared pool. On top of
  that, `_shared/spend-alert.ts` DETECTS abuse: `recordUsage` pages the owner once, via
  `AI_SPEND_ALERT_WEBHOOK_URL`, the first time a user's monthly spend crosses
  `USER_SPEND_ALERT_MICROS` (`$8`, 80% of the sub-cap) — a signal that an account may be
  compromised or misused _before_ it hits the wall. **Unset webhook ⇒ no-op** (local/CI safe); the
  body fits a plain Slack **or** Discord incoming webhook. Best-effort — never fails the user's
  request. See ADR-0029.

## Invite codes (ADR-0030)

The one deliberate exception to "no service-role in functions": creating a brand-new Auth account
requires `auth.admin.createUser`, which has no non-admin path. So `_shared/admin.ts` is the single
service-role client, fenced to **redeem-invite** and **dispatch-messages** (ADR-0031) — the two
callers with no user JWT. Everything else is still least-privilege: the
claim / throttle / release logic lives in `SECURITY DEFINER` RPCs
(`supabase/migrations/20260707044212_invites.sql`) granted to `service_role` **only**, so the whole
invite mechanism is off the public PostgREST surface. Backed by three tables — `invites` (owner-RLS,
list/revoke), `invite_redemptions` (audit), `invite_attempts` (throttle log, no grants). Codes are
128-bit, single-use by default, expiring, and revocable. `generate-invite` is gated by
`OWNER_USER_ID`; `redeem-invite` is gated by the code + a per-IP throttle, not by auth.

## Proactive notifications (ADR-0031)

`dispatch-messages` is the hourly proactive dispatcher — an opt-in, default-off morning **plan** push
+ evening **recap** push. It is triggered ONLY by `.github/workflows/notify.yml` (hourly cron) with
the `x-dispatch-secret` header; with no user JWT it runs on the `_shared/admin.ts` service-role client
via `service_role`-only `SECURITY DEFINER` RPCs (the `*_for_user` guardrails +
`notification_candidates` / `dispatch_inputs_for_user` / `push_subscriptions_for_user` /
`prune_push_subscription`; migrations `20260707140000` + `20260707150000`). For each user whose LOCAL
hour matches their morning/evening pref it CLAIMS today's message idempotently (`claim_message` — the
row insert is the send lock), generates the plan into `daily_state` under the same `$20`/`$10`
budget guardrails as interactive AI, upgrades the claimed message to the plan-rich body
(`enrich_message`, migration `20260708000000`), and pushes via `_shared/web-push.ts` (RFC 8291
aes128gcm + VAPID, pinned to the RFC vectors). The morning body IS the plan — headline, 🪨 big rock,
⚡ quick wins, 💪 habits; a sparse plan renders as an open day, never padded — and the evening push is
a check-in listing the morning plan's unfinished items, answered in chat where BabyClaw marks them
done (`_shared/dispatch.ts`). Degrades cleanly: a paused budget ⇒ a deterministic message; unset
VAPID ⇒ the message still lands in the in-app inbox (`messages`), push is skipped. See ADR-0031 +
`src/features/notifications/README.md`.

## Local dev

```bash
supabase start                 # local stack (Docker)
supabase functions serve       # serve all functions, hot-reload (per_worker)
# functions live at http://127.0.0.1:54321/functions/v1/<name>
```

Secrets (production; only the human can set — the hook blocks `.env*` + the key value):

```bash
supabase secrets set ANTHROPIC_API_KEY=...        # owner key (required for PR3/PR4)
supabase secrets set ALLOWED_ORIGIN=https://<app> # prod origin for CORS (dev defaults to localhost:5173)
supabase secrets set OWNER_USER_ID=<uuid>         # who may generate invite codes (ADR-0030)
supabase secrets set AI_SPEND_ALERT_WEBHOOK_URL=https://hooks.slack.com/...  # OPTIONAL: owner
#   per-user spend alert. Slack or Discord incoming-webhook URL (or any receiver). Unset ⇒ alerts
#   are silently off. Server-only — never a VITE_* var / never in the bundle (it's not a frontend var).
supabase secrets set DISPATCH_SECRET=...          # notify.yml's shared caller gate (ADR-0031); ALSO
#   set as a GitHub Actions secret of the same name.
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
#   Web Push (ADR-0031). Generate the pair with generateVapidKeys() in _shared/web-push.ts. Unset ⇒
#   push skipped (messages still persist to the inbox). VAPID_PUBLIC_KEY also ships to the frontend as
#   VITE_VAPID_PUBLIC_KEY (Vercel env) — it's public; the PRIVATE key is server-only.
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the platform
— no secret to set (the service-role key is used only by `_shared/admin.ts`; never bundled or logged).

## Testing

- **Pure logic** → `deno test --allow-env --no-check _shared/` (cors origin-lock, cost math).
- **DB guardrails** → applied by `supabase db reset`; behaviour proven with a psql proof
  (rate-limit raise, kill-switch, ledger invisibility, anon block).
- **Function end-to-end** → `supabase functions serve` + curl (auth/401, status body).
- **CORS caveat:** local `supabase functions serve` injects a permissive
  `Access-Control-Allow-Origin: *` at the gateway, so the origin-lock can't be observed via
  local curl. The lock is verified by the `cors.ts` deno unit test (the function's own headers
  are what apply in production); re-verify against the deployed function in Stage 6.

## Toolchain note

`supabase/functions/**` is **excluded from the frontend ESLint** (different runtime/globals +
`npm:`/`jsr:` specifiers) and from `tsc -b` (`src`-only). It is checked with Deno
(`deno test` / `deno check`). Prettier still formats it (one repo formatter). CI auto-deploy of
functions is deferred to Stage 6; until then deploy is manual (`supabase functions deploy <name>`).
