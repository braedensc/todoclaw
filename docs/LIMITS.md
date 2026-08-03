# Limits, Caps & Guardrails Reference

A single inventory of every quantitative limit, quota, rate limit, spend cap, size cap,
and access boundary in TodoClaw — what each one is, its scope (**per‑user vs global vs
per‑IP vs per‑request**), the layer that enforces it, and whether it's a fixed constant or
owner‑tunable.

> **Scope of truth.** This reflects `main`. Values are cited by **file + constant/column
> name** (not line numbers, which rot); grep the name to find it. The per-IP throttles and the
> web-push timeout / SSRF allowlist landed in #311 (2026‑07‑22) and are live.
>
> **Keeping this current.** When you add or change a limit, update the matching row here in
> the same PR. This is a reference, not a spec — code + the `src/lib/*.test.ts` oracle are
> authoritative for behavior. Last full sweep: **2026‑07‑22**.

---

## The defense stack (outer → inner)

```
1. Gateway (verify_jwt)      → OFF for all fns in prod (CORS preflight) — not a real gate
2. Per-IP throttle           → coarse flood guard, BEFORE auth              [per-IP]
3. In-function auth          → requireUser 401 / isOwner 403 / DISPATCH_SECRET
4. Per-user AI rate limits   → chat/plan hour+day request counts            [per-user]
5. AI spend kill-switches    → global $ pool + per-user $ sub-cap           [global + per-user]
6. Input validation          → Zod (edge + client) + DB CHECK size/length   [per-request/row]
7. DB write-path volume caps → per-user row-count caps (AFTER INSERT trig)  [per-user]
8. RLS + DEFINER fences      → the actual data vault                        [per-user/system]
```

Layers 2, 4, 5, 7 are *quantitative limits*; 3 and 8 are *access boundaries*. Every function
runs `verify_jwt=false` in prod (see [ARCHITECTURE](./ARCHITECTURE.md) / config.toml) so the
CORS preflight reaches it; auth is verified **in-function** and RLS isolates data independently.

---

## 1. Access boundary per endpoint (who can call what)

| Function | Gate | DB client |
|---|---|---|
| `redeem-invite` | **PUBLIC** — no login; gated by invite code + per-IP throttle | service_role |
| `ai-chat` | **Login** (`requireUser`→401) + budget/rate precheck | userClient (RLS); admin only for transcript RPCs |
| `plan-my-day` | **Login** + budget/rate precheck | userClient (RLS) |
| `ai-status` | **Login** | userClient (RLS) |
| `resolve-location` | **Login** + per-user rate limit | userClient (RLS) |
| `generate-invite` | **Owner-only** (`isOwner`→403) | service_role for the insert |
| `admin` | `whoami` = any login; `get_overview` = **owner-only** | userClient for identity; service_role reads |
| `dispatch-messages` | **Secret** (`DISPATCH_SECRET` header→403) | service_role (whole fn) |
| `dispatch-reminders` | **Secret** (`DISPATCH_SECRET` header→403) | service_role (whole fn) |

- **Owner** = one account via the `OWNER_USER_ID` env var (`_shared/owner.ts`). Unset ⇒ nobody
  is owner ⇒ owner endpoints 403 for everyone (**fail-closed**).
- **`DISPATCH_SECRET`** unset ⇒ every cron request 403 (**fail-closed**).

---

## 2. Per-IP throttles (pre-auth flood guards)

Coarse ceilings checked **before** auth. Limits are **hardcoded constants** at each call site
(not owner-tunable). Backed by DEFINER RPCs over no-grant tables (`edge_ip_events`,
`invite_attempts`). IP source: `cf-connecting-ip` → `x-real-ip` → **rightmost** X-Forwarded-For
(never the spoofable leftmost).

| Function / bucket | Limit | Window | On limiter error |
|---|---|---|---|
| `ai-status` | 300 | 60s | **fail-open** (allow) |
| `ai-chat` | 240 | 60s | fail-open |
| `plan-my-day` | 120 | 60s | fail-open |
| `admin` | 120 | 60s | fail-open |
| `generate-invite` | 60 | 60s | fail-open |
| `redeem-invite` (`invite_throttle`) | 10 | **600s** (10 min) | **fail-closed** (500) |
| `resolve-location` | *(none)* | — | — |
| `dispatch-*` | *(none — secret-gated, single infra IP)* | — | — |

Files: `ip-throttle.ts`, `client-ip.ts`, migration `*_edge_ip_throttle.sql`;
`redeem-invite/index.ts` (`THROTTLE_LIMIT`/`THROTTLE_WINDOW_SECONDS`), `invites.sql` (`invite_throttle`).

---

## 3. AI rate limits (per-user) — owner-tunable via `app_config`

| Feature | Default | Owner max (HARD_MAX) | Notes |
|---|---|---|---|
| `chat` | **30/hour, 100/day** | 200/hr, 2000/day | trailing-window row count |
| `plan_my_day` | **10/hour, 10/day** | 50/hr, 50/day | hour==day ⇒ effective daily cap |
| **Total AI backstop** | **4000 rows/user/day** (all features) | fixed | anti-abuse ceiling (`ai_usage_check_and_record`) |

Defaults in `guardrails-constants.ts` (`LIMITS`); live values from `app_config` (Admin panel),
clamped read-side to `HARD_MAX` (`guardrails-config.ts`) and by DB CHECK
(`*_app_config_and_admin_reads.sql`). Enforced by `ai_usage_check_and_record`, which raises
`rate_limited_hour`/`rate_limited_day`.

---

## 4. AI spend / budget kill-switches

| Limit | Value | Scope | Tunable? |
|---|---|---|---|
| Global monthly pool (`BUDGET_CAP_MICROS`) | **$20.00/mo** | global | owner-tunable ≤ **$100** |
| Per-user monthly sub-cap (`USER_BUDGET_CAP_MICROS`) | **$10.00/mo** | per-user | owner-tunable ≤ **$50** (must stay ≤ global) |
| Per-call spend ceiling (`PER_CALL_CEILING_MICROS`) | **$0.20** | per-call | **fixed** rail (also SQL-clamped in `ai_budget_add`) |
| Owner spend-alert (`SPEND_ALERT_FRACTION`) | **80%** of per-user cap | per-user | fixed fraction |
| Output tokens per call (`MAX_TOKENS`) | **2048** | per-call | fixed |
| Token cost formula (`costMicros`) | **$3/1M in, $15/1M out** | per-call | fixed (conservative over-count) |
| Config cache TTL (`CACHE_TTL_MS`) | 30s | per-worker | fixed |

Enforcement order (`precheck`): global pool → per-user sub-cap → per-user rate limit. Ledgers
live in **no-grant DEFINER-only** tables (`ai_budget_ledger`, `ai_user_budget_ledger`).

---

## 5. DB write-path volume caps (per-user row caps)

`AFTER INSERT` triggers that raise when a count exceeds the cap (upsert-safe). Constants mirrored
in `_shared/write-caps.ts`; triggers in `*_write_path_volume_caps.sql`.

| Table | Cap | Scope |
|---|---|---|
| tasks (live) | **2000** | per-user |
| tasks (total, incl. soft-deleted) | 10000 | per-user |
| habits (live / total) | 200 / 1000 | per-user |
| history (completions) | 10000 | per-user |
| task_reminders per task | **8** | per-task |
| task_reminders per user | 2000 | per-user |
| push_subscriptions | 20 | per-user |
| backups | 15 | per-user |
| chat_sessions | 100 | per-user |
| chat_messages | 2000 | per-session |
| assistant_memories | 30 | per-user |
| daily_state | ±14-day date window (no row cap) | per-user |

Edge-fetch read bounds (so an at-cap account can't balloon function memory / tokens):
`TASKS_FETCH_LIMIT` 500, `HABITS_FETCH_LIMIT` 250, `REMINDERS_FETCH_LIMIT` 1000 (`write-caps.ts`).

---

## 6. Input / size validation caps

**Auth inputs** (`redeem-invite` / `generate-invite`, mirrored in `src/types/invite.ts`):

| Field | Cap |
|---|---|
| password | 8–128 chars (Supabase platform floor is 6) |
| invite code | 1–64 chars |
| email | format only (no length cap) |
| `maxUses` | 1–50 (default 1) |
| `expiresInDays` | 1–90 (default 7) |

**Text / content:**

| Field | Cap |
|---|---|
| task / habit / history text | 2000 chars (DB CHECK + BabyClaw tools; **no client-side cap on grid/list/mobile-add** — DB CHECK is the backstop) |
| bucket label | 100 |
| chat user message / seed / deny-note | **4000** each |
| chat `tool_use_id` | 200 |
| assistant memory content | 1–240 |
| location / commitment label | 120 (`SHORT_MAX`) |
| plan notes / custom instructions | 500 |
| per-day notes | 280 · time fields 40 · greeting name 40 |

**Chat / AI request bounds:**

| Bound | Value |
|---|---|
| tool iterations per HTTP request (`MAX_TOOL_ITERATIONS`) | **8** |
| memory writes per request (`MAX_MEMORY_WRITES_PER_REQUEST`) | 2 |
| chat replay window | 60 messages / 50,000 chars (`WINDOW_LIMIT` / `WINDOW_MAX_CHARS`) |
| Plan My Day arrays | tasks 200, recurringDue 100, habits 100 |

**jsonb / blob size CHECKs:** task.recurring ≤8 KB · daily_state maps ≤256 KB each ·
daily_state.plan ≤64 KB · backups.data ≤4 MB · chat content ≤64 KB / meta ≤16 KB ·
schedule config ≤32 KB.

**Numeric ranges:** reminder offset 0–40320 min (28 d) · localHour 0–23 · free-time 0–24 h ·
grid x/y 0–1 · commitments array 12 · recurring cadence 1–365 (client UI).

---

## 7. Push / dispatch / reminder pipeline

| Bound | Value | Note |
|---|---|---|
| web-push fetch timeout (`DEFAULT_PUSH_TIMEOUT_MS`) | **10s** | AbortController per POST |
| SSRF host allowlist (`ALLOWED_PUSH_HOSTS`) | 4 push services | runtime + DB CHECK |
| reminder sweep batch (`BATCH_LIMIT` / SQL clamp) | **500/run** (clamped ≤2000) | oldest-first |
| reminder run deadline (`RUN_DEADLINE_MS`) | **50s** | then defers the rest |
| reminder freshness window | 60 min | older = retired / advanced |
| push payload max (`MAX_PAYLOAD_BYTES`) | 3951 bytes (`RECORD_SIZE` 4096) | throws if exceeded |
| digest push body truncation (`PUSH_BODY_MAX`) | 1800 chars | reminders have no body cap |
| VAPID JWT TTL (`VAPID_TOKEN_TTL_SECONDS`) | 12 h | under RFC 8292 24 h ceiling |
| push message TTL (default) | 28 days | |
| pg_net cron HTTP timeout | 30s | raised from 5s default |
| cron cadence | reminders + digest **every minute**; GH-Actions backup hourly | edge fn self-gates to each user's local hour |
| weather cache TTL / fetch timeout | 30 min / 5s | global shared cache |

---

## 8. Invite / signup system

- **`enable_signup = false`** (config.toml) — no public self-registration;
  `enable_anonymous_sign_ins = false`. The only account path is `redeem-invite` (or the owner
  via dashboard / admin API). *(Note: `[auth.email].enable_signup = true` gates email **login** —
  do not flip it or everyone is locked out.)*
- Invite code = **16 random bytes (128-bit entropy)**, Crockford base32, 26 chars
  (`_shared/invite-code.ts`) — entropy is the primary guard.
- Single-use atomic claim (`claim_invite_code`, `SELECT … FOR UPDATE`); a failed
  `createUser` releases the claim so the code isn't burned.
- `email_confirm: true` — the code is the vouch; no email-verification step.
- `max_uses` 1–50, `expires_at` required (owner-only-mint migration + Zod). Defaults 1 use / 7 days.

---

## 9. The data vault: RLS + DEFINER fences

- **Every public table (~21) has RLS enabled**, owner-scoped `user_id = auth.uid()`; `anon`
  sees nothing. Static + live CI guards (`scripts/check-rls*.mjs`).
- **Delete posture is deliberate:** tasks / habits / daily_state / user_schedule = no delete
  (soft-delete or immutable); history / backups / push_subscriptions / memories = owner delete;
  chat = delete-own.
- **Tables with RLS on and *zero* grants/policies** — reachable only via SECURITY DEFINER RPCs:
  `ai_budget_ledger`, `ai_user_budget_ledger`, `weather_cache`, `invite_attempts`, `app_config`,
  and `edge_ip_events`.
- **DEFINER RPCs fenced to `service_role` only** (system/cron path, un-callable by the anon key):
  invite lifecycle, dispatch RPCs, reminder sweep, chat transcript writes, admin roster reads,
  per-user guardrail-system RPCs, `memories_for_user`.

---

## 10. Supabase platform limits (config.toml)

`api.max_rows = 1000` · `jwt_expiry = 3600s` · `file_size_limit = 50 MiB` · pooler 20 / 100 conns ·
auth rate-limits: sign-in/sign-up **30 / 5 min per IP**, token_refresh 150 / 5 min, email_sent
2 / hr, anonymous 30 / hr, OTP length 6 / expiry 1 h · MFA max 10 factors · refresh-token reuse
interval 10s · `minimum_password_length = 6`.

---

## Notable observations & known gaps

1. **Per-IP throttle limits are hardcoded** (unlike AI rate/budget, which are `app_config`-tunable).
   Changing them needs a code edit + redeploy.
2. **`resolve-location` has a per-user rate limit but no per-IP throttle** — a small asymmetry
   vs. the other functions.
3. **Direct task/habit creation from the grid/list has no *client-side* length cap** — bounded
   only by the DB CHECK (2000) and the BabyClaw tool schemas.
4. **`edge_ip_throttle` fails open; `invite_throttle` fails closed** — deliberate (availability
   vs. abuse-guard), but they differ.
5. **Reminders have no push-body truncation** (`PUSH_BODY_MAX` applies only to the digest);
   reminder content is short and deterministic, so this is fine in practice.

---

*Generated from a full-codebase audit (10-agent sweep, 2026-07-22). If a number here disagrees
with the code, the code wins — fix the doc.*
