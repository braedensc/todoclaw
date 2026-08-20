# ADR 2026-08-20 — Per-feature model knobs + the scaled monthly budget (phase 0, "stabilize the wallet")

**Date:** 2026-08-20 · **Status:** Accepted · amends [ADR-0015](0015-ownerkey-ai-architecture-ratelimit-budget-guardrails.md)'s guardrail set; resolves the "model is a fixed safety rail" note in `_shared/guardrails-config.ts`

Phase 0 of the cost-scaling roadmap. This ADR covers the whole phase's *decisions*; the code lands
across PRs (PR 1: model knobs + model-aware cost + all phase-0 schema; follow-ups: scaled-cap
enforcement, prompt caching).

## Decision 1 — the model becomes an ALLOWLISTED runtime knob

The model was deliberately NOT owner-tunable ("a fixed safety rail, never editable" —
guardrails-config.ts) because a free-text model knob could point spend at an arbitrarily expensive
model. That risk is real but the fix is an **allowlist**, not immutability: `app_config.chat_model`
/ `app_config.plan_model` are CHECK-constrained columns, validated again in `app_config_set`, in
the admin Edge Function's Zod schema, and clamped per-key at read time (`parseConfig` — an invalid
stored value degrades to the default without nulling the rest of the config, so a pre-migration
read can never wipe tuned caps). Flipping production to Haiku becomes an admin-panel action, not a
deploy. Defaults stay `claude-sonnet-5`, so shipping the knob changes nothing by itself.

## Decision 2 — per-feature allowlists resolve the $0.20-clamp risk

Pricing (verified 2026-08-20): haiku-4-5 **$1/$5**, sonnet-5 **$3/$15**, opus-5 **$5/$25** per 1M
tokens. The fixed per-call clamp (`PER_CALL_CEILING_MICROS` = $0.20, also SQL-clamped in
`ai_budget_add`) is sized for Sonnet chat; on Opus a worst-case chat call (~60k input tokens from
ai-chat's replay window) would cost 60 000×5 + 2048×25 ≈ **$0.35** — over the clamp, so the ledger
would under-record real spend. The plan path's prompt is small: a generous worst case (10k input,
full 2048 output) on Opus is 10 000×5 + 2048×25 = **101 200 micros ≈ $0.10**, comfortably inside.

Therefore: **chat ∈ {haiku, sonnet}; plan ∈ {haiku, sonnet, opus}; the $0.20 clamp is unchanged.**
The headroom number is pinned in `guardrails.test.ts`. `costMicros(input, output, model)` prices
each call at its model's own rates, with a conservative Sonnet fallback for unknown/missing ids.
The recap intentionally rides the plan knob (it already shares the `plan_my_day` feature key).

## Decision 3 — the manual ceiling becomes the cap's ceiling, re-seeded $20 → $60

The follow-up cap-scaling PR computes, in TS at precheck time:

```
effectiveCap = min(ai_budget_base_micros + userBudgetCapMicros × activeUsers,
                   global_budget_cap_micros,        -- the owner's manual ceiling
                   $100)                            -- HARD_MAX, immovable
```

`activeUsers` = `ai_active_user_count()` (a DEFINER count of this UTC month's spenders — aggregate
only, no PII, granted to `authenticated` with a reviewed entry in check-definer-grants). A failed
count degrades to 0 ⇒ cap = base — fail-closed. **Semantics change:** `global_budget_cap_micros`
stops being "the budget" and becomes the *ceiling* the scaled value may never exceed. Left at its
$20 seed it would clamp scaling into a no-op (the stored-seed trap), so PR 1 re-seeds it to
**$60** — guarded (`where … = 20000000`) so an owner-customized value is never clobbered — and
raises the column default to match. This is PR 1's only behavior change: the kill-switch trips at
$60 instead of $20. Base ($10) + per-user slice ($10) keep solo-month worst-case spend near
today's.

## Decision 4 — cache-prefix stability invariant (for the prompt-caching PR)

The prompt-caching follow-up marks the static prompt prefix (tools + system) with
`cache_control`; caching is a byte-exact prefix match, so **any new prompt surface must keep
static content first and put per-request/minute-granular content (context, timestamps) after the
last static block**. A timestamp interpolated into the system prompt's head silently zeroes every
cache hit. This invariant binds chat-prompt.ts and both plan/recap system prompts from now on —
cheaper to honor before the caching PR lands than to re-litigate after.

## Consequences

- One migration (`20260820210850`) carries all phase-0 schema: model columns + base,
  `app_config_set` (service_role-only DEFINER write path + `app_config_audit` append-only log),
  `ai_active_user_count`, extended `app_config_get`. Follow-up PRs are migration-free or
  independent.
- `anthropic.ts` keeps a static `MODEL` export (= the default) — the eval judge pins to it and
  evals have zero CI coverage, so removing it would break them silently.
- Admin → Guardrails gains two model dropdowns (Save = `set_config`); cap editing is accepted by
  the same action but stays read-only in the UI for now.
- Flipping chat to Haiku is deferred to the re-baseline PR (evals against the real model first);
  the production flip itself is an admin action, not a deploy.
