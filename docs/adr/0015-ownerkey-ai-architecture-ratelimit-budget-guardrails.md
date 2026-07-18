# ADR-0015 — Owner-key AI architecture + rate-limit/budget guardrails

**Date:** 2026-06-24 · **Stage:** 4 (PR2) · **Status:** Accepted

All Stage 4 AI runs on the **owner's** Anthropic key, **server-side only**, in Supabase Edge
Functions (Deno 2). This ADR records the architecture every AI feature (Plan My Day → PR3, chat
→ PR4) sits on; this PR builds the shared foundation + guardrails + a proof endpoint (`ai-status`).

**Key handling (the hard invariant).** `ANTHROPIC_API_KEY` is an Edge Function secret
(`supabase secrets set`), read via `Deno.env`. It is **never** a `VITE_*` var, never in the
bundle, never logged. The frontend calls functions through the Supabase client (which attaches
the user's JWT); the model is only ever reached server-side.

**Request path (`supabase/functions/_shared/`).** `cors.ts` locks `Access-Control-Allow-Origin`
to an `ALLOWED_ORIGIN` allow-list (never `*` — Discrepancy #7); `auth.ts` builds a Supabase
client scoped to the **caller's JWT**, so every DB call runs under RLS as the real user and
`auth.uid()` is server-derived (the model never supplies `user_id`). There is **no service-role
client** in any AI function — a prompt-injected tool can at worst touch the caller's own rows
(RLS), and destructive tools require confirmation (PR4). Inputs are Zod-validated at the boundary.

**Guardrails that bound the owner's key** (migration `20260624010000_ai_usage_and_budget.sql`):

- **Per-user rate limits** — `ai_usage` (append-only event rows; same owner-scoped RLS pattern
  as every table) + `ai_usage_check_and_record` (**SECURITY INVOKER**: counts the caller's
  trailing-hour/day rows for a feature, raises when over, else records the request). Append-only
  rows (not a mutable counter) avoid a read-modify-write race and need no cron reset — the
  trailing window self-expires.
- **Global monthly budget kill-switch** — `ai_budget_ledger`, one row per `YYYY-MM` accumulating
  spend in micro-dollars. It is **global** (not user-scoped), so RLS can't express "only the
  system writes it"; instead the table has RLS on with **no grants and no policies** → invisible
  to app roles, reachable **only** through `ai_budget_check` / `ai_budget_add` (**SECURITY
  DEFINER**, run as owner). This is the deliberate way to keep the **service-role key out of the
  functions**: the ledger is reached via these RPCs under the caller's JWT, never an admin client.
  `auth.uid()` still identifies the caller inside a DEFINER function (it reads the JWT claim, not
  the function owner). Monthly reset is cron-free — a new month is a new PK row at zero (the same
  "row-existence is the reset" philosophy as `daily_state`, ADR-0007).

**Cost model.** `claude-sonnet-5` for both AI features (cost-aware choice; originally
`claude-sonnet-4-6`, switched to **Sonnet 5** on 2026-07-02 — Anthropic's most agentic Sonnet, at the
same **$3/$15 standard** price, with **$2/$10 introductory** pricing through 2026-08-31). Cost is
computed from the response `usage` at $3/$15 per 1M in/out into micro-dollars (`input*3 + output*15` —
which slightly over-counts during the intro window, a safe direction for the kill-switch) and added
to the ledger post-call. **Balanced tier** (chosen 2026-06-24):
global cap **$20/month**; per-user **chat 30/hour + 100/day**, **Plan My Day 10/day**. Limits +
cap are constants in `guardrails.ts` — tunable without a schema change.

**Hardening (2026-07-06 security audit).** The guardrail RPCs/tables are reachable directly via
PostgREST with the public anon key (outside the Edge Functions). Migration
`20260706000000_ai_guardrail_rpc_hardening.sql` closes three bypasses: (1) `ai_budget_add` now
rejects negative amounts and clamps positives to a per-call ceiling (a negative would have driven
the ledger negative and uncapped the kill-switch; a huge positive would have paused AI for everyone
— a monthly DoS); (2) the `ai_usage` UPDATE grant is narrowed from table-wide to the two
token-backfill columns, so a user can no longer PATCH `called_at` to slide rows out of the
rate-limit window; (3) a **per-user monthly sub-cap** (`ai_user_budget_ledger` +
`ai_user_budget_check`, checked in `precheck`; cap `USER_BUDGET_CAP_MICROS = $10` in `guardrails.ts`)
stops one heavy account draining the global $20 pool and pausing AI for everyone. No service-role
client was introduced — the new ledger uses the same DEFINER-only pattern as `ai_budget_ledger`.

**Further hardening (2026-07-13 audit).** `ai_budget_add` was still callable directly via PostgREST
often enough to trip the global switch (the clamp bounds one call, not the count). It is now **bound
to a rate-limited usage row** — it takes the `ai_usage` id from `precheck`, requires it to be the
caller's own and unbilled (`ai_usage.billed_at`), and bills it at most once — so the ledger can move
only in step with real, sub-capped usage. See ADR 2026-07-13-babyclaw-budget-invite-hardening (which
also closes the owner-only-invite bypass, L3).

**Verified.** `supabase db reset` applies the migration; a psql proof confirms the rate-limit
raises after N, the kill-switch returns negative remaining once over cap, `ai_budget_ledger` is
`permission denied` for `authenticated`, and the DEFINER functions raise for an anon caller.
The `ai-status` function was driven end-to-end (`supabase functions serve` + curl): authed →
200 + status; no token → 401. Deno unit tests cover the CORS origin-lock and the cost math.

**CORS caveat (local).** `supabase functions serve` injects a permissive
`Access-Control-Allow-Origin: *` at the local gateway, so the origin-lock can't be observed via
local curl; the function's own headers are what apply in production (this is why every Supabase
function sets its own CORS). The lock is verified by the `cors.ts` deno unit test; re-verify
against the deployed function in Stage 6.

**Consent deviation (recorded).** The original "AI opt-in, off by default" gate is **deferred**
for the invite-only MVP (ADR-0014): AI is available to every signed-in/trusted user, bounded by
the guardrails above rather than per-user consent. Re-adding consent later is a thin layer (a
boolean + a one-time notice gating the panels + a server-side check) — no rework of this
architecture. The planner stays fully usable without AI.

**Deferred:** CI auto-deploy of functions (manual `supabase functions deploy` for now → Stage 6);
a public version's billing model (OpenRouter OAuth / paid SaaS — never raw BYOK; ADR-0014).
