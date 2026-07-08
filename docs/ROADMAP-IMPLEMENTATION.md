# Todoclaw Scaling Roadmap — Implementation Plan

Companion to [`ROADMAP.md`](./ROADMAP.md): the file-level plan for the six scaling
workstreams, grounded in the codebase as of 2026-07-08 via multi-agent research and
adversarial verification. Each phase below has had its verifier folded in — factual
corrections applied (the verifier checked every path against the real tree, so it wins
on facts), missing steps added, and step ordering reflowed. Every phase came back
`needs-fixes`; none was `solid`, none `major-gaps`. The fixes are already baked into
the workstreams here.

**Effort key:** `S` = < 1 day · `M` = a few days · `L` = a week+

---

## Shared foundations (build once, several phases reuse)

The workflow's `sharedFoundations` field came back empty, so these are derived from the
cross-phase dependency graph. They are the load-bearing seams where phases collide —
build them once, in Phase 0, and the rest inherit their shape.

- **The AI enforcement choke point — `guardrails.ts` + `guardrails.test.ts`.** Phase 0
  adds model/cost cases, Phase 1 adds an `mcp` rate-limit feature, Phase 3a adds tier
  gating, Infra's fan-out stress-tests concurrency through it. These *must* land in a
  coordinated order or they collide. **Phase 0 establishes the file's shape first.**
  (Corrected: there is a *parallel* gate too — `guardrails-system.ts`
  `precheckForUser`/`recordUsageForUser` on the proactive path — that every phase
  touching enforcement must edit in lockstep with `guardrails.ts`.)
- **The `app_config` write path** — `app_config_set` (owner-gated `SECURITY DEFINER`
  RPC) + an admin edge-fn write action + owner UI. Phase 0 builds it; Phase 3a reuses
  the exact pattern for runtime tier/entitlement config. Reusable for any future
  runtime-editable setting (feature flags, per-user AI opt-in re-add).
- **Per-user budget ledger + model-aware cost accounting** — `ai_user_budget_ledger`,
  the `USER_BUDGET_CAP_MICROS` sub-cap, and per-model `costMicros`. Phase 0 defines
  them; Phase 1's `generate_plan` over MCP self-gates on the sub-cap; Phase 3a leans on
  the per-user budget as the metering substrate for Pro.
- **Owner-gate + service-role `DEFINER`-RPC pattern** — `_shared/owner.ts` `isOwner`,
  `_shared/admin.ts` `adminClient()`, and the invite system's claim/release/record
  RPCs. Reused by Phase 1 (opaque-token resolution) and Phase 3a (`subscription_upsert`
  / webhook). **Corrected:** `adminClient()`'s "fenced to exactly one caller" comment
  is already stale — it has **three** callers today (`redeem-invite`, `admin`,
  `dispatch-messages`). Each phase that adds a fourth/fifth (mcp, stripe-webhook) is a
  security-boundary change warranting an ADR and a comment update.
- **The hardcoded deploy loop — `.github/workflows/deploy.yml:191`.** It is a *literal*
  list, not a glob: `for fn in ai-status plan-my-day ai-chat dispatch-messages
  generate-invite redeem-invite admin`. Every new function (Phase 1 `mcp`, Infra
  `dispatch-user`, Phase 3a `stripe-webhook`/`create-checkout-session`/
  `create-billing-portal-session`) **silently will not deploy** until added here. This
  is a per-phase footgun with no red CI signal.
- **The frontend hosting surface — `vercel.json` + `src/lib/route.ts` hash router.**
  Phase 1 (well-known/OAuth rewrites), Phase 2 (PWA manifest/SW), and Phase 3a
  (billing + legal routes) all mutate it; concurrent edits conflict.
- **Migration serialization.** Phases 0, 1, 3a, and Infra each add a Supabase
  migration. Per CLAUDE.md these must be timestamp-ordered off latest `main` and never
  generated in parallel worktrees — a hard serialization constraint linking all four.
- **The Vercel Hobby → Pro cutover** is one move with two drivers: Phase 3a (commercial
  charging violates Hobby's non-commercial ToS) and Infra WS4 (tier ceilings). Whichever
  trigger fires first pulls the other phase's work forward.

---

## Recommended sequencing

Honoring "payments last" and "BYO-AI/MCP before billing":

1. **First — Phase 0 (cost-opt), the economic and infrastructural keystone.** It ships
   `app_config_set` (the reusable write path), the model-aware cost table, the per-user
   budget ledger/sub-cap, and the guardrails choke-point shape that Phases 1/3a/Infra
   all extend. CLAUDE.md's Hard Rule 6 plus the "ship before widening the audience" note
   make this a true prerequisite: don't invite more users onto the owner's wallet until
   the scaling cap and per-model accounting exist. **Phase 0 is the only hard sequential
   root.**
2. **In parallel with Phase 0 — Phase 2 (multi-browser + PWA).** Almost entirely
   frontend/testing; it touches no shared backend substrate (only `vercel.json` /
   manifest), so it runs concurrently with zero contention and unblocks the Phase 4 iOS
   baseline. The ideal parallel track.
3. **After Phase 0 settles guardrails/cost — Phase 1 (MCP) and Infra WS1/WS2 in
   parallel.** Both consume Phase 0's guardrails + budget ledger but not each other. MCP
   delivers BYO-AI (must precede billing); Infra's fan-out + pruning harden the platform
   before the audience grows. Coordinate migration timestamps between them.
4. **Last of the shippable — Phase 3a (pricing/payments).** It needs Phase 0's
   tier-gating substrate, reserves the `byo_ai` enum for Phase 1's already-shipped MCP
   path, and its public-launch prerequisites (ToS/Privacy, public signup, Vercel Pro)
   coincide with Infra WS3/WS4 — land those together as the "go public" gate immediately
   before charging. Payments is deliberately terminal.
5. **Deferred / decision-only — Phase 4 (iOS).** A scoping ladder, not a build. It waits
   on Phase 2 (delivered) and Phase 3's Apple-IAP-vs-web billing decision. No engineering
   slot until a go/no-go on EventKit forces rung 4.

After the Phase 0 root, the graph fans out — frontend (2) and external-AI + infra
(1 + Infra) parallelize cleanly — then re-converges at the public-launch/payments gate
(3a + Infra WS3/WS4).

---

## Phase 0 — Stabilize the wallet (cost optimization)

**Goal:** Cut per-request AI spend and make the model owner-switchable at runtime (no
deploy), on the owner's single Anthropic key, before widening the audience — preserving
the no-AI-required invariant, the no-service-role-in-frontend rule, and RLS. Three
levers: (1) a global monthly cap that scales with active users instead of a flat $20
that pauses AI for everyone; (2) an admin-controlled, allowlisted model per feature
(chat on Haiku, Plan-My-Day on Sonnet/Opus) with model-aware cost accounting;
(3) Anthropic prompt caching on the static system prompt + tool schemas.
· **Estimate:** L (~1 week / 5–8 focused days) · **Verifier verdict:** `needs-fixes`
(grounded: true)

### Current state
- Model is hardcoded: `anthropic.ts:12` exports `MODEL = 'claude-sonnet-5'`,
  `MAX_TOKENS = 2048`, consumed at three live call sites — `ai-chat/index.ts:132`
  (streaming, agentic tool loop), `_shared/run-plan.ts:36` (forced `emit_plan`),
  `plan-my-day/index.ts:59` (forced `emit_plan`) — plus indirectly via
  `dispatch-messages/index.ts:174` which calls `generatePlan()` (`run-plan.ts:29`,
  hardwired to the imported `MODEL`).
- Cost is hardwired to Sonnet-5 pricing: `guardrails.ts:63`
  `costMicros = input*3 + output*15`, called in `recordUsage` (`guardrails.ts:119,128`)
  and `recordUsageForUser` (`guardrails-system.ts:60`). Neither takes a model.
- Config plumbing exists but has **no model and no write path**. `app_config` (migration
  `20260707160000_app_config_and_admin_reads.sql`) is a CHECK-clamped singleton with a
  read RPC `app_config_get`; there is **no** `app_config_set` — the migration header and
  `src/features/admin/README.md` explicitly defer the write path. `loadConfig`
  (`guardrails-config.ts:93`) reads `app_config_get`, `parseConfig` (`:54`) validates six
  numeric keys, clamps to `HARD_MAX`, caches 30s per-isolate, falls back to constants on
  any failure. `admin/index.ts` only implements `get_overview`; `AdminPage.tsx:161`
  renders Model as a hardcoded literal `"claude-sonnet-5"`.
- Global cap is a flat $20: `BUDGET_CAP_MICROS = 20_000_000` (`guardrails-constants.ts:18`),
  stored in `app_config.global_budget_cap_micros` (default 20000000, CHECK ≤ $100). A
  per-user sub-cap ($10, `USER_BUDGET_CAP_MICROS`) already exists via
  `ai_user_budget_check`. `PER_CALL_CEILING_MICROS = 200_000` is a fixed SQL rail in
  `ai_budget_add`. The proactive path mirrors everything through service_role
  `*_for_user`/`*_system` RPCs and `guardrails-system.ts`.
- Prompt caching: **not used anywhere** (`grep cache_control` → none). SDK pinned at
  `@anthropic-ai/sdk@0.105.0` (supports `cache_control: {type:'ephemeral'}`). Chat
  `system` is a joined string (`buildSystem`, `chat-prompt.ts:198`); tools are
  `TOOL_DEFS` (`chat-tools.ts:34`). Plan `SYSTEM_PROMPT` + `EMIT_PLAN_TOOL` are fully
  static.

> **Blocking prerequisite (do this before WS1):** confirm the actual current Anthropic
> model ids and live pricing via the `claude-api` skill before hardcoding any allowlist
> CHECK or the `MODEL_PRICING` table. The codebase uses `claude-sonnet-5` (its 2026
> timeline); the exact ids for Haiku 4.5 / Opus and whether Sonnet-5 introductory
> pricing is still active must be verified — a wrong id breaks *all* AI for that feature.
> This gates WS1 (the CHECK) and WS2 (the price table), not the test stage.

> **Reframe applied (correction):** what the draft called "auto-scaling" is really a
> **manual-ceiling** model. The effective cap is
> `min(base + perUser*activeCount, stored global_budget_cap_micros, HARD_MAX.global)`.
> Since `global_budget_cap_micros` defaults to $20 and is kept as the ceiling, the scaled
> value is clamped back to $20 out of the box and scaling does *nothing* until the owner
> raises the ceiling column — and can never exceed $100 without editing both the migration
> CHECK and `HARD_MAX.global`. State this plainly in the ADR; the "scales with users"
> language is aspirational unless the owner also raises the ceiling.

### Workstreams

#### WS1 — Model + scaling knobs in `app_config` schema + write RPC (one migration) · `M`
- [ ] Confirm allowlisted model ids + pricing first (see blocking prerequisite above).
- [ ] Create ONE new migration (timestamp last; pull `main` first per the serialized-migration rule). Add to `app_config`: `chat_model text not null default 'claude-sonnet-5'`, `plan_model text not null default 'claude-sonnet-5'`, each CHECK against a literal allowlist. For the scaling cap add `global_budget_base_micros bigint` (default 20000000) + `global_budget_per_user_micros bigint` (default e.g. 2000000/$2), both CHECK-bounded; keep `global_budget_cap_micros` as the HARD ceiling clamp for the computed value.
- [ ] Decide the CHECK bound for the scaled value: either define a concrete `HARD_MAX_USERS` constant (the draft references it but none exists) or bound `base + per_user*count` via the existing `HARD_MAX.global` ceiling instead — pick one and use it consistently.
- [ ] Add `app_config_set(...)` `SECURITY DEFINER`, `set search_path=public`, `revoke all from public`, `grant execute to service_role` ONLY (mirror the invite/admin RPC fencing). Body updates the singleton (id=1), sets `updated_by`/`updated_at`; use `least()`/`greatest()` clamps as the second defense layer. Disallowed models are rejected by the CHECK (raises → surfaced as an edge-fn error).
- [ ] Add a cheap `SECURITY DEFINER` `ai_active_user_count(p_period text default null) returns integer` = distinct users in `ai_user_budget_ledger` for the period (count only, no PII). Grant execute to authenticated + service_role.
- [ ] Extend `app_config_get`'s `jsonb_build_object` to emit `chatModel`, `planModel`, `globalBudgetBaseMicros`, `globalBudgetPerUserMicros`. Keep existing keys unchanged (back-compat).
- [ ] Write the Down path in the migration header comment (drop the new RPCs, drop the added columns).
- **Files:** `supabase/migrations/20260707160000_app_config_and_admin_reads.sql` (reference)
- **New:** `supabase/migrations/<new-ts>_app_config_set_and_model.sql`
- **Done when:** `supabase db reset` runs clean; `app_config_get` returns the new keys; `app_config_set` is callable only by service_role (authenticated/anon → permission-denied); a disallowed model value is rejected by the CHECK.

#### WS2 — Thread model + scaling cap through the config loader · `M`
> Ordering: WS1 is a hard prerequisite for WS2 (loadConfig calls the new RPC and parses
> new keys). WS1 and WS2 must land **atomically** — `HARD_MAX` ↔ migration CHECK is a
> documented sync invariant now spanning the model allowlist. The migration
> (auto-deploys on merge) must land before/with the function change, else new-parser vs
> old-DB drops the whole config to fallback.
- [ ] Extend `GuardrailConfig` (`guardrails-config.ts:22`) with `chatModel: string`, `planModel: string`.
- [ ] Extend `parseConfig` (`:54`) to read/validate the two model strings against an allowlist constant (unknown → fall back to the default model, never throw) and to read the two scaling knobs. **Make the new model/scaling keys OPTIONAL (default to constants), not required** — `parseConfig` currently returns null (→ full FALLBACK_CONFIG) if any required numeric key is missing, so a read predating the migration or a partial payload would silently nuke the model switch. A missing new key must never drop the rest of the config.
- [ ] Compute the EFFECTIVE global cap inside `loadConfig` (`:93`): call `ai_active_user_count`; **on NULL/failed count, use count = 0 (→ effective cap = base, never unbounded)**. Set `globalBudgetCapMicros = clampInt(base + perUser*count, HARD_MAX.global)`, still clamped by the stored `global_budget_cap_micros`. The existing 30s per-isolate cache amortizes the extra round-trip; a read failure still returns FALLBACK_CONFIG unchanged.
- [ ] Nail down what `ai_active_user_count` counts as "active" (recommend: distinct spenders this month, cheap in `ai_user_budget_ledger`) and document it.
- [ ] Add the model allowlist + a per-model price table to `guardrails-constants.ts` (import-free module): `MODEL_PRICING: Record<string,{inMicrosPerTok:number; outMicrosPerTok:number}>` (Sonnet 3/15, Haiku cheaper, Opus higher), plus `DEFAULT_CHAT_MODEL`/`DEFAULT_PLAN_MODEL`.
- [ ] Update `FALLBACK_CONFIG` and the `HARD_MAX`/CHECK mirror comment to include the new knobs; keep `HARD_MAX` in sync with the migration CHECKs.
- **Files:** `supabase/functions/_shared/guardrails-config.ts`, `supabase/functions/_shared/guardrails-constants.ts`
- **Done when:** unit test — `parseConfig` returns chat/plan models and falls back to default on an unknown model string; effective global cap = base + perUser*activeCount clamped to `HARD_MAX`; a config-read failure is behavior-identical to today (flat fallback); a missing new key does not drop the rest of the config.

#### WS3 — Model-aware cost accounting · `S`
> Ordering: WS3/WS4 change `costMicros`/`recordUsage`/`recordUsageForUser` signatures.
> The **existing** `guardrails.test.ts` and `guardrails-system.test.ts` reference those
> symbols and will break — they must be updated in the **same commit/PR**, not deferred
> to WS7, or Deno check/tests fail.
- [ ] Change `costMicros` (`guardrails.ts:63`) to `costMicros(input, output, model)` using `MODEL_PRICING[model]` with a conservative fallback to Sonnet 3/15 for an unknown model (keeps the over-count-safe direction).
- [ ] Thread `model` into `recordUsage` (`guardrails.ts:107`) — callers pass the model actually used; update its internal `costMicros` calls (`:119,128`) and the alert reconstruction.
- [ ] Mirror in `recordUsageForUser` (`guardrails-system.ts:52`) — add a `model` param, pass to `costMicros` (`:60`).
- [ ] **Fix the per-call clamp for pricier models (correction — do NOT "keep as-is").** The fixed `PER_CALL_CEILING_MICROS = 200_000` ($0.20) SQL clamp in `ai_budget_add` — and the identical clamp in `ai_budget_add_for_user` (verify in `20260707140000`) — is **not** a safe backstop once `chat_model`/`plan_model` can be Opus. Opus (~$15in/$75out per Mtok) at 2048 output tokens ≈ 153,600 micros of output alone; add a few thousand input tokens and one call exceeds $0.20, so the ledger records only $0.20 and *under-counts* real spend — the kill-switch trips late and real Anthropic spend can exceed the caps. Choose one: a **model-aware clamp**, a **lower `MAX_TOKENS` for pricier models**, or **exclude Opus from the allowlist**. Apply the same fix to both the interactive and `_for_user`/system clamps.
- [ ] Update the existing `guardrails.test.ts` + `guardrails-system.test.ts` call sites in this same PR.
- **Files:** `supabase/functions/_shared/guardrails.ts`, `supabase/functions/_shared/guardrails-system.ts`
- **Done when:** unit test — `costMicros` yields Haiku < Sonnet < Opus for identical tokens; unknown model → Sonnet pricing (safe over-count); the per-call clamp no longer under-counts an Opus call (model-aware or excluded).

#### WS4 — Use the per-feature model at all four call sites + tiering · `M`
> Correction: threading the model only through the interactive path leaves the **system
> path** (dispatch-messages) under-counting identically. Include it below.
- [ ] `ai-chat` (`index.ts:131`): load cfg (reuse the one `precheck` loads — expose it), pass `model: cfg.chatModel` to `a.messages.stream`, and pass `cfg.chatModel` into the final `recordUsage` (flushUsage, `:110`). Chat defaults to Haiku.
- [ ] `run-plan` (`run-plan.ts:29,53`): give `generatePlan` a `model` (and optional `maxTokens`) param instead of the imported constant; `runPlanForUser` loads cfg, passes `cfg.planModel`, and passes it to `recordUsage` (`:87`).
- [ ] `plan-my-day` (`index.ts:58,68`): load cfg, pass `cfg.planModel` to `messages.create` and to `recordUsage`.
- [ ] `dispatch-messages` (`index.ts:174`, `maybeGeneratePlan`): load cfg via `loadConfig(admin)`, pass `cfg.planModel` to `generatePlan(...)` and to `recordUsageForUser`. The `anthropic()` factory itself is unchanged (still just the key).
- [ ] Keep `MAX_TOKENS` as a shared default (unless lowered per WS3 for pricier models); make the `MODEL` export in `anthropic.ts` a `DEFAULT_*` re-export for tests/back-compat.
- **Files:** `supabase/functions/ai-chat/index.ts`, `supabase/functions/_shared/run-plan.ts`, `supabase/functions/plan-my-day/index.ts`, `supabase/functions/dispatch-messages/index.ts`, `supabase/functions/_shared/anthropic.ts`
- **Done when:** with `chat_model=Haiku`, `plan_model=Sonnet` in `app_config`, an ai-chat request calls Anthropic with the Haiku id and Plan-My-Day/dispatch with Sonnet (verify via a mocked SDK spy in a Deno unit test); changing the row and waiting out the 30s cache flips the model with no redeploy.

#### WS5 — Admin write path: edge-fn action + owner UI · `M`
- [ ] `admin/index.ts`: add a `set_config` action to `BodySchema` (`z.discriminatedUnion` on `action`). Zod-validate every knob (budgets/limits as bounded ints mirroring `HARD_MAX` — the third clamp layer; models against the allowlist enum). The owner gate (`isOwner`) already precedes this; call `admin.rpc('app_config_set', {...})` with `p_updated_by: user.id`; return the fresh config.
- [ ] `use-admin.ts`: extend `GuardrailConfigDto` with `chatModel`/`planModel` + scaling knobs; add a `useSetConfig()` mutation invoking `admin` with `action:'set_config'` and invalidating `ADMIN_OVERVIEW_KEY`.
- [ ] `AdminPage.tsx`: replace the hardcoded Model row (`:161`) with two `<select>` dropdowns (chat model, plan model) bound to the allowlist; optionally make cap/limit rows editable. Show the computed effective global cap + active-user count from the overview. Owner-only UI (already fenced by `useIsOwner` + server 403).
- [ ] Keep "no secret values reach the client" — models + caps are non-secret config.
- **Files:** `supabase/functions/admin/index.ts`, `src/features/admin/use-admin.ts`, `src/features/admin/AdminPage.tsx`, `src/features/admin/README.md`
- **Done when:** owner can switch chat/plan model and edit caps from `/#/admin`; a non-owner `set_config` POST gets 403; an out-of-range/disallowed value is rejected (Zod 400 or CHECK 500); the Guardrails section reflects saved values after invalidation.

#### WS6 — Anthropic prompt caching on static system prompt + tool schemas · `M`
- [ ] Chat: split the system into content blocks. Add `buildSystemBlocks(ctx)` in `chat-prompt.ts` returning `[{type:'text', text:<static prefix>, cache_control:{type:'ephemeral'}}, {type:'text', text:<volatile contextBlock>}]`. **Spell out which blocks cache vs stay volatile:** the `USER PREFERENCES` block sits between `SYSTEM_PREFIX` and the volatile context in `buildSystem` (`chat-prompt.ts:198`) — folding per-user prefs into the cached block is fine (cache is per-account), but the static/volatile split must be explicit so a preferences change doesn't silently invalidate every turn. In `ai-chat/index.ts:135` pass the array as `system`.
- [ ] Chat tools: mark the LAST entry of `TOOL_DEFS` (`chat-tools.ts:34`) with `cache_control:{type:'ephemeral'}` so the whole tools block caches. **First confirm** the combined prefix+tools exceeds the model's min-cacheable-token floor (Sonnet ~1024, Haiku ~2048) via a token count — under the floor, the breakpoint is a silent no-op that adds a 25% write surcharge on misses. Only place breakpoints where content clears the bar.
- [ ] Plan path (~10 calls/day): gate behind measurement — optionally add `cache_control` to `EMIT_PLAN_TOOL` and split `SYSTEM_PROMPT`. Lower ROI (5-min TTL vs sparse calls); recommend chat-only first.
- [ ] Verify the pinned SDK (`@anthropic-ai/sdk@0.105.0`) types accept `cache_control` on system text blocks and tools (add a typed cast only if the Deno type surface complains).
- **Files:** `supabase/functions/_shared/chat-prompt.ts`, `supabase/functions/ai-chat/index.ts`, `supabase/functions/_shared/chat-tools.ts`
- **Done when:** a follow-up chat turn within the cache window reports `cache_read_input_tokens > 0`; the cached prefix+tools bytes are identical across turns; recorded cost drops on cache hits.

#### WS7 — Tests, ADR, docs · `S`
> Note: the *breaking* test updates for `costMicros`/`recordUsage`/`recordUsageForUser`
> live with WS3/WS4 (same PR). WS7 is the *new-coverage* + docs pass.
- [ ] Add new cases to `guardrails.test.ts` / `guardrails-config` tests: per-model `costMicros`, model fallback, effective-cap scaling formula, `parseConfig` new keys (incl. the optional-key back-compat case), `HARD_MAX` ↔ CHECK sync assertion, and the Opus-clamp fix.
- [ ] Add an admin `set_config` test (owner-only, validation) alongside `use-admin.test.ts`.
- [ ] Write ONE ADR covering: (a) model is now an allowlisted, owner-switchable runtime knob (resolving the `guardrails-config.ts` "model is a fixed safety rail" note — the rail becomes an allowlist + kept per-call clamp), (b) the manual-ceiling scaling-cap model, (c) prompt caching + the cache-prefix stability invariant.
- [ ] Fix stale docs made stale by this change: `guardrails-config.ts` header, `src/features/admin/README.md` (both say the model is fixed), **`anthropic.ts` header comment**, and **`supabase/functions/README.md:15`** (both document `MODEL`/`MAX_TOKENS` as the fixed choice).
- [ ] Confirm CI: run Deno checks locally (CI runs Prettier over the tree, *not* Deno tests — verify formatting), plus `npm test`/`typecheck`/`lint`.
- **New:** `docs/adr/ADR-00xx-switchable-model-scaling-cap-prompt-caching.md`, new `guardrails.test.ts` cases
- **Done when:** all new unit tests green; ADR merged; no doc still claims the model is fixed/un-editable.

### Open decisions
- **Global-cap model:** dynamic formula `base + per_user × active-count` (recommended) vs. keep a flat cap but surface the active-user count for manual bumping. If dynamic, define "active user" (recommend: distinct spenders this month). Note that with the ceiling column defaulted to $20, scaling is inert until the owner raises it — is that acceptable, or should the ceiling default track the formula?
- **Opus in the allowlist at all?** Given the per-call clamp under-count risk, the cleanest fix may be to exclude Opus and cap the allowlist at Sonnet/Haiku — decide vs. a model-aware clamp.
- **Exact allowlisted model ids + price rates** — requires confirmation against the current Anthropic model list (blocking).
- **Make caps/limits editable now** (the migration+README already scoped `set_config` for them) or ship only the model switch + scaling cap? Recommend including caps since `app_config_set` covers them for free.
- **Prompt caching on the plan path** — worth it at ~10 calls/day + 5-min TTL, or chat-only? Recommend chat-only first, then measure.
- **Lower `MAX_TOKENS` for chat specifically** (further output-cost cut) or keep 2048 uniformly?

### Risks
- Wrong model id breaks all AI for a feature — mitigated by the allowlist CHECK + loadConfig fallback-to-default.
- `costMicros` drives the kill-switch: keep the conservative over-count direction; the Opus clamp under-count (above) is the concrete failure mode.
- Prompt-cache no-op below the min-cacheable floor (esp. Haiku ~2048) adds a 25% write surcharge on misses — measure first.
- Haiku chat quality on the agentic tool loop (`MAX_TOOL_ITERATIONS=8`) may degrade multi-step reasoning / destructive-confirmation phrasing — ship behind the admin switch (instantly reversible) and validate on the golden chat spec.
- Scaling-cap hot-path cost: an `ai_active_user_count` failure must fall back to count=0 / the stored flat cap, never to unbounded.
- Migration serialization + `HARD_MAX`↔CHECK drift is a documented sync hazard.
- No-AI invariant: all changes stay inside the AI edge functions + owner-only admin; the app must still run fully with AI paused/unconfigured.

### Depends on / feeds
- **Feeds Phase 1, 3a, and Infra:** `app_config_set` is reusable write infrastructure; the scaling cap + per-model cost accounting make owner-wallet economics safe as user count grows (ship before inviting more users); the per-user budget sub-cap is what Phase 1's `generate_plan`-over-MCP self-gates on; the guardrails choke-point shape is what 3a's tier gating and Infra's fan-out extend.
- **Reuses:** the owner-gate + service_role fencing from `generate-invite`/`admin` (unchanged).

---

## Phase 1 — Offload with MCP (BYO-AI)

**Goal:** Expose the existing transport-agnostic capability registry over a Model
Context Protocol (MCP) Streamable-HTTP endpoint so users can drive their own Todoclaw
planner from their own Claude/ChatGPT subscription — inference on the user's wallet,
only tool *execution* (DB writes, and optionally the owner-key `generate_plan`) on ours.
This is the second adapter over `_shared/capabilities/`, exactly the "future MCP server"
the layer was designed for, with no change to any capability.
· **Estimate:** L (a week-plus; the effort and uncertainty live in auth) ·
**Verifier verdict:** `needs-fixes` (grounded: true)

### Current state
- The capability layer is already the single, transport-agnostic source of truth.
  `capabilities/registry.ts:10-14` assembles 21 capabilities (10 task tools, 10 habit
  tools, 1 `generate_plan`) plus `capabilityByName` and the server-classified
  `DESTRUCTIVE` set. Each capability is `{name, description, schema (zod), destructive,
  execute(ctx, input)}`; the zod `schema` is the one source of truth, rendered to JSON
  Schema by the adapter. `CapabilityContext` carries only the caller's JWT-scoped
  Supabase `client`, `timeZone`, optional `now`, optional injected `services.generatePlan`
  — never a service-role client.
- The Anthropic adapter `_shared/chat-tools.ts` is the exact template: `TOOL_DEFS` maps
  each capability via `z.toJSONSchema(schema,{target:'draft-7'})` (dropping `$schema`);
  `executeTool` does validate-then-execute; `destructiveSummary` builds confirm labels.
  `capabilities/README.md:35-39` already sketches the MCP adapter and marks it deferred.
- Auth today: `_shared/auth.ts` `userClient(req)` builds a Supabase client from the
  forwarded `Authorization` header (RLS applies, `auth.uid()` is the real user);
  `requireUser` verifies via `client.auth.getUser()`. The sole service-role client
  (`_shared/admin.ts`) is documented as fenced to `redeem-invite` (**stale — see
  correction**). Every AI function runs `verify_jwt=false` at the gateway and re-checks
  the JWT in-function. `config.toml:383-389` has a `[auth.oauth_server]` block
  (`enabled=false`, `allow_dynamic_registration=false`). Signup is invite-only and hard
  off (`enable_signup=false`, `config.toml:183`).
- `generate_plan` wiring: `ai-chat/index.ts:95-99` injects
  `services:{generatePlan:()=>runPlanForUser(client,timeZone)}`. `runPlanForUser`
  (`run-plan.ts:53-95`) carries its own `plan_my_day` rate-limit + budget gate via
  `precheck`/`recordUsage`, so it self-gates even from an external MCP client. `timeZone`
  reads `user_schedule.timezone` (default 'UTC').
- Guardrails: `precheck(client, feature)` runs global budget → per-user sub-cap → rate
  limit; `Feature` is `'chat'|'plan_my_day'`. The `ai_usage.feature` column is free
  `text` with no CHECK, so a new rate-limit *feature value* needs no migration — **but
  see the WS6 correction: the loaded-config path still needs work to make it
  owner-tunable.**

### Workstreams

> **Reordered per verifier:** the auth resolution (was WS4) and the config.toml/deploy.yml
> registration half of WS6 are prerequisites for the `mcp` function's (was WS3)
> acceptance to be *meetable* — you cannot create rows under the caller's RLS identity
> without token→RLS resolution. Sequence: Spike → adapter → **auth + registration** →
> function wiring/acceptance → OAuth connector path → rate-limit/CI tail.

#### WS1 — Spike: MCP transport on Deno (SDK vs hand-rolled) · `S`
- [ ] Try importing the official `npm:@modelcontextprotocol/sdk` `Server` + `StreamableHTTPServerTransport` into a scratch Deno edge function; the SDK transport is written against Node http/Express req/res, whereas edge functions use Fetch-API Request/Response under `Deno.serve` — confirm whether it adapts or fights the runtime.
- [ ] Decide: reuse only the SDK's type/schema definitions but hand-roll the JSON-RPC handler over `Deno.serve` (recommended, matches the codebase's hand-rolled `sse.ts`/`web-push.ts` style), OR adopt the full SDK if the transport works.
- [ ] Nail the Streamable-HTTP contract to implement statelessly: POST accepts a JSON-RPC request, returns `application/json` or `text/event-stream`; handle `initialize` (advertise protocolVersion + `capabilities.tools`), `notifications/initialized`, `tools/list`, `tools/call`. Stateless mode (no session-id persistence) — edge functions are already stateless per request.
- [ ] Write a throwaway `curl` script: initialize → tools/list → tools/call against local `supabase functions serve` to validate the wire format before wiring auth.
- **Files:** `supabase/functions/deno.json`, `supabase/functions/deno.lock`
- **New:** scratchpad spike function (not committed)
- **Done when:** a recorded decision (hand-roll vs SDK) plus a working local curl transcript round-tripping initialize/tools/list/tools/call against a stub handler.

#### WS2 — MCP adapter over the capability registry · `M`
- [ ] Create `_shared/mcp-tools.ts` as the SECOND adapter, mirroring `chat-tools.ts` but emitting MCP wire shapes.
- [ ] `MCP_TOOL_DEFS`: map each capability to `{name, description, inputSchema: toInputSchema(schema), annotations}` — reuse the SAME `z.toJSONSchema(schema,{target:'draft-7'})`+drop-`$schema` helper so there is no second hand-kept schema. Set annotations from the registry: `destructiveHint: DESTRUCTIVE.has(name)`, `readOnlyHint` true for `list_*` tools.
- [ ] `callTool(name, rawInput, ctx)`: reuse the exact validate-then-execute path (`capabilityByName` → `schema.safeParse` → `execute` → catch), returning MCP `CallToolResult` `{content:[{type:'text',text}], isError}`. Consider importing `executeTool` and re-shaping its return to avoid duplicating logic.
- [ ] Keep the file a pure registry→MCP mapping: no auth, transport, or Supabase-client construction (same discipline as `chat-tools.ts`).
- [ ] Add `_shared/mcp-tools.test.ts`: every capability appears in `MCP_TOOL_DEFS` with a valid JSON Schema, destructive tools carry `destructiveHint`, `callTool` round-trips a known task capability against a fake client.
- **Files:** `supabase/functions/_shared/chat-tools.ts` (template)
- **New:** `supabase/functions/_shared/mcp-tools.ts`, `supabase/functions/_shared/mcp-tools.test.ts`
- **Done when:** `MCP_TOOL_DEFS` lists all 21 tools with correct schemas + annotations; `callTool` executes a non-destructive tool through the real capability and returns MCP-shaped content; Deno tests green.

#### WS3 — Auth path A (ships first): opaque per-user MCP token → RLS client · `L`
> This lands **before** the mcp function's acceptance (WS4) — the function can only be
> stubbed until token→RLS resolution exists.
- [ ] Migration `<ts>_mcp_tokens.sql`: table `mcp_tokens(id, user_id references auth.users, token_hash text unique, label, created_at, last_used_at, revoked_at)`; RLS `user_id = auth.uid()` so the owner lists/revokes their own tokens; a `SECURITY DEFINER` RPC `mcp_resolve_token(p_hash)` granted to service_role only, returning the non-revoked user_id (mirrors the invite claim-RPC pattern, keeping the table off the public PostgREST surface).
- [ ] Token issuance: a small authenticated path (under the user's normal app JWT) that generates a high-entropy opaque token, stores only its hash, returns the plaintext ONCE. Never log the plaintext (Hard Rule 2).
- [ ] Token→RLS-client exchange (the crux): the mcp function reads `Authorization: Bearer <opaque>`, resolves it to user_id via the DEFINER RPC using the service-role admin client, then obtains a short-lived Supabase JWT for that user so `ctx.client` still runs under RLS (never service-role for capability calls). Two sub-options (pick in Open Decisions):
  - **(a)** store the user's refresh_token at issuance and `refreshSession()` per request. **Caveat (correction):** `config.toml:171-173` has `enable_refresh_token_rotation=true` + `refresh_token_reuse_interval=10` — a rotated refresh token is single-use, so a stored refresh token breaks after first use. This makes (a) materially harder (rotation bookkeeping), not just "rotation handling."
  - **(b)** mint a short-lived JWT signed with the project JWT secret set as a managed function secret (`role:authenticated, sub:user_id`), then `userClient` with it. **The JWT secret is NOT auto-injected** (only `SUPABASE_URL`/`ANON`/`SERVICE_ROLE` are), so this introduces a new sensitive managed secret + a manual owner setup step + an ADR.
- [ ] **Verify (b) actually yields a working RLS identity:** confirm a JWT self-signed with the project secret (`role:authenticated, sub:user_id`) is accepted by PostgREST so `auth.uid() = sub`. This is the crux of the whole path and is currently asserted-but-unverified.
- [ ] This path unblocks Claude **Desktop** and **IDE** clients via the `npx mcp-remote --header 'Authorization: Bearer <token>'` bridge — no OAuth server needed to ship value.
- [ ] Frontend: add an MCP-connection settings surface in `src/features/ai/` to create/copy/revoke tokens and show the `mcp-remote` connection snippet.
- [ ] **Update `admin.ts`'s stale "only/single-consumer" fencing comment** and add an ADR for (a) the new service-role consumer and (b) the JWT-signing managed secret if sub-option (b) is chosen. (Correction: `adminClient()` already has three callers today; this is a documented security-boundary change per CLAUDE.md.)
- **Files:** `supabase/config.toml`, `supabase/functions/_shared/admin.ts`, `src/features/ai/README.md`
- **New:** `supabase/migrations/<ts>_mcp_tokens.sql`, `src/features/ai/McpConnections.tsx`, token-issue path in the mcp function (or ai-status)
- **Done when:** a user generates a token in-app, configures Claude Desktop via `mcp-remote`, and lists/creates tasks; the token maps to their RLS identity (cannot see another user's rows); revoke immediately kills access; no plaintext token is ever logged or stored.

#### WS4 — The `mcp` edge function (Streamable-HTTP JSON-RPC handler) · `M`
> Prerequisite: the config.toml `[functions.mcp]` registration + deploy.yml entry from
> WS6 must exist first (local `supabase functions serve` tolerates their absence; any
> deployed test does not).
- [ ] Create `supabase/functions/mcp/index.ts`. On OPTIONS return preflight; keep `_shared/cors.ts` for parity and any browser-based inspector.
- [ ] Resolve the caller → user + JWT-scoped client via WS3's auth resolution (or 401). Reject unauthenticated with an HTTP 401 carrying `WWW-Authenticate: Bearer resource_metadata=...` (required by MCP OAuth clients to start discovery).
- [ ] Parse the JSON-RPC body. Route: `initialize` → `{protocolVersion, capabilities:{tools:{}}, serverInfo:{name:'todoclaw', version}}`; `tools/list` → `{tools: MCP_TOOL_DEFS}`; `tools/call` → rate-limit (WS6) then `callTool(params.name, params.arguments, ctx)`; unknown method → JSON-RPC error `-32601`.
- [ ] Build `ctx`: `client` from WS3, `timeZone` from a `user_schedule.timezone` read (default 'UTC'), and `services:{generatePlan:()=>runPlanForUser(client, timeZone)}` (identical to `ai-chat/index.ts:95-99`) so `generate_plan` self-gates on the `plan_my_day` budget; or omit the service for graceful degradation (`plan.ts:19` already handles this).
- [ ] Keep `DESTRUCTIVE` server-classified but do NOT hard-block: MCP defers per-call confirmation to the client. Surface `destructiveHint` via annotations; the server still enforces RLS + zod validation as the real guard.
- [ ] **Confirm the per-user budget sub-cap bounds an abusive external caller** before wiring `services.generatePlan` — this is the one place BYO-AI leaks onto the owner's wallet. Make it an acceptance line, not just a risk.
- [ ] Add `supabase/functions/mcp/README.md` documenting the endpoint, methods, auth, and the BYO-AI cost model.
- **Files:** `supabase/functions/_shared/run-plan.ts`, `supabase/functions/ai-chat/index.ts` (reference)
- **New:** `supabase/functions/mcp/index.ts`, `supabase/functions/mcp/README.md`
- **Done when:** a local MCP client (or curl) can initialize, list all 21 tools, call `create_task`/`list_tasks` and see the row created under the caller's RLS identity, call `generate_plan` which persists a plan and respects the `plan_my_day` gate; unknown methods return proper JSON-RPC errors.

#### WS5 — Auth path B (Claude.ai connectors): OAuth 2.1 discovery + DCR + PKCE · `L`
- [ ] Decide the authorization server: **(a)** enable Supabase's native `[auth.oauth_server]` (`config.toml:383-389`) with `allow_dynamic_registration=true` and verify its issued tokens are accepted by `client.auth.getUser()`/RLS and that it ships a usable `/oauth/consent` UI — cleanest, but newer/beta, MUST be validated end-to-end; or **(b)** hand-roll a minimal OAuth 2.1 AS wrapping Supabase Auth.
- [ ] Serve MCP OAuth discovery docs: `/.well-known/oauth-protected-resource` (RFC 9728, path-aware for the mcp resource) pointing at the AS, and ensure the AS serves `/.well-known/oauth-authorization-server` (RFC 8414) advertising registration/authorize/token endpoints + PKCE (S256). The WS4 401 must include `WWW-Authenticate: Bearer resource_metadata=...`.
- [ ] Solve well-known routing: edge functions live under `/functions/v1/mcp` but discovery is expected at the resource origin root. Choose a Vercel rewrite on the app domain proxying `/.well-known/*` + the MCP path, or serve the well-knowns from the function with a custom functions domain — record as an Open Decision.
- [ ] Implement/enable Dynamic Client Registration (RFC 7591) so claude.ai can self-register, plus PKCE on authorize/token. The access token must resolve to the same JWT-scoped `ctx.client`.
- [ ] Register/list the server as a Claude connector and verify the full browser OAuth consent → token → tools/call loop. Treat ChatGPT MCP as out of scope for now (newer/gated) — Claude connectors first.
- **Files:** `supabase/config.toml`, `vercel.json`
- **New:** OAuth discovery handlers, possible consent UI page, `vercel.json` rewrite rules for `/.well-known/*`
- **Done when:** adding Todoclaw as a Claude.ai custom connector triggers OAuth (discovery → DCR → PKCE → consent), after which Claude lists and calls tools under the authenticated user's RLS identity — no pasted token.

#### WS6 — Guardrails, rate limit, config & CI wiring · `S`
> Split by dependency order: the **config.toml + deploy.yml** half is a prerequisite for
> WS4/WS5 (serve/deploy); the **rate-limit-feature** half can stay late.
- [ ] Register the function in `config.toml` with `[functions.mcp] verify_jwt = false`. **This is strictly mandatory here (correction), not just the CORS-preflight nicety it is for the browser AI functions:** under WS3's opaque-token scheme the bearer is NOT a Supabase JWT, so the gateway JWT check would 401 every real MCP call.
- [ ] **Add `mcp` to the literal deploy loop at `deploy.yml:191` (correction):** it is an explicit allow-list, not a glob, so the function does not auto-deploy until listed. Add `--no-verify-jwt` alongside the existing functions.
- [ ] Add an `mcp` rate-limit feature: extend the `Feature` type + `LIMITS` in `guardrails-constants.ts`. For `tools/call`, apply a **rate-limit-only** gate (call `ai_usage_check_and_record` directly, not full `precheck`) since tool execution costs us no Anthropic tokens — the Anthropic budget kill-switch only needs to bite `generate_plan`, which already self-gates.
- [ ] **To make the `mcp` limit owner-tunable, edit `guardrails-config.ts` `buildConfig` too (correction):** it constructs `cfg.limits` with ONLY `chat` + `plan_my_day` keys and does *not* spread the `LIMITS` default, so `cfg.limits['mcp']` is `undefined` on the normal loaded-config path even after you add `mcp` to `LIMITS`. Owner-tunable ⇒ `guardrails-config.ts` edit **plus** `app_config` mcp-limit columns + `HARD_MAX` (a migration). If instead you take the limit straight from the `LIMITS` constant, it works but is **not** owner-tunable — pick one and don't claim both.
- [ ] Flag the manual owner step: any new function secret (the JWT signing secret if WS3 sub-option b is chosen) must be set in the Supabase dashboard before first use.
- [ ] **Regression gate:** run the existing `registry.test.ts` / golden suite to prove `ai-chat` is unregressed after touching the shared registry/adapter path (crossPhaseDeps require "must not regress ai-chat" but no step enforced it).
- [ ] Update `_shared/capabilities/README.md`: move the MCP adapter from "future" to "built"; cross-link the new function + adapter.
- **Files:** `supabase/functions/_shared/guardrails-constants.ts`, `supabase/functions/_shared/guardrails-config.ts`, `supabase/functions/_shared/guardrails.ts`, `supabase/config.toml`, `.github/workflows/deploy.yml`, `supabase/functions/_shared/capabilities/README.md`
- **New:** `supabase/functions/mcp/index.test.ts` (optional handler test)
- **Done when:** `tools/call` is per-user rate-limited without touching the Anthropic budget; `generate_plan` still respects the `plan_my_day` + budget gate; config.toml + deploy.yml register the function with JWT verify off; README reflects the shipped adapter; `ai-chat` golden/registry tests still green.

### Open decisions
- Auth backend for Claude connectors: enable Supabase native OAuth server (bet on the beta) vs. hand-roll a minimal OAuth 2.1 AS. Recommendation: spike native first; hand-roll only if it can't satisfy RLS token acceptance.
- Ship order: interim opaque-token path (WS3) FIRST for Desktop/`mcp-remote`, then the OAuth connector path (WS5). Confirm this staging is acceptable vs. holding for OAuth-only.
- Token→RLS exchange sub-option: stored refresh token + `refreshSession` (stateful, single-use-rotation collision) vs. minting a short-lived signed JWT with a managed JWT-secret function secret. Security/ops tradeoff.
- `generate_plan` over MCP: wire `ctx.services.generatePlan` (spends owner budget, self-gated) vs. graceful degradation (report unavailable, keep BYO-AI purely on the user's wallet). Recommendation: wire it but lean on the per-user sub-cap.
- Well-known discovery hosting: Vercel rewrite on the app domain vs. a custom Supabase functions domain — affects the MCP resource identifier URL Claude registers against.
- Should MCP connection require an explicit per-user opt-in given the owner-key/`generate_plan` exposure, or is being an invited user sufficient (mirroring ADR-0014/0015's deferred consent gate)?
- ChatGPT MCP support deferred (newer/gated) — confirm Claude-first is the agreed target.

### Risks
- OAuth is the crux and biggest unknown; Claude.ai connectors *require* a remote OAuth 2.1 server with discovery + DCR + PKCE (no pasted-token option), so WS3 only serves Desktop/IDE via the bridge — full connector support depends on WS5.
- Supabase's native OAuth server is default-disabled and relatively new; token acceptance by RLS and the `/oauth/consent` UI's production-readiness are unproven — validate in a spike before committing WS5 to it.
- Token→RLS exchange introduces either a stateful refresh-token store (with the rotation collision) or a new sensitive managed JWT secret + manual owner setup + attack surface.
- `generate_plan` from an external client spends the owner's Anthropic budget — verify the per-user sub-cap bounds an abusive caller.
- The MCP TS SDK's transport targets Node http/Express, not Deno's Fetch-API `Deno.serve` — hand-rolling JSON-RPC (recommended) is small but must implement initialize/tools/list/tools/call and content shapes exactly or clients silently fail.
- Well-known discovery routing touches hosting config and is easy to get subtly wrong (Claude's client is strict about metadata URLs).
- Human-in-the-loop for destructive tools shifts from our server to the MCP client's approval UX; RLS still contains blast radius to the caller's own rows, but the UX guarantee weakens (`destructiveHint` is advisory only).

### Depends on / feeds
- **Depends on** Phase 0's guardrails/budget substrate (the `mcp` rate-limit feature and `generate_plan`'s `plan_my_day` gate) and the already-shipped capability layer (`chat-tools.ts` adapter) — adds a parallel adapter, changes no capability, must not regress `ai-chat`.
- **Reuses** the service-role admin client + DEFINER-RPC pattern from the invite system for opaque-token resolution.
- **Feeds** Phase 3a: MCP *is* the `byo_ai` tier's execution path — 3a only reserves the enum; the BYO-AI leg must ship here first (honors "BYO-AI before billing"). Provides a reusable external-auth + BYO-AI pattern for any later third-party-integration phase.

---

## Phase 2 — Reach every browser + install (multi-browser + PWA)

**Goal:** Make Chrome, Edge (Chromium), Safari/WebKit, and Firefox behave identically —
proven by an expanded Playwright matrix in CI and a real-device manual pass — and harden
the already-scaffolded PWA (manifest, service worker, push, install prompt) into a
reliably installable app whose install unlocks iOS Web Push and serves an offline shell.
· **Estimate:** L (~1.5–2 weeks; WS2 + WS3 dominate, the rest largely parallelizable) ·
**Verifier verdict:** `needs-fixes` (grounded: **false** — the drag-lifecycle file was
miscited three times; corrected below)

### Current state
The PWA is already substantially built — this phase is mostly verification + gap-closing,
not greenfield.

**Cross-browser testing (the real gap):**
- Smoke config `playwright.config.ts:22` defines a single `chromium` project;
  `testIgnore: '**/golden/**'`. Boots Vite with dummy Supabase env — no DB needed.
- Golden config `playwright.golden.config.ts` runs against the live local Supabase stack
  with two projects: `chromium` (desktop specs) and `chromium-mobile` (Pixel 7,
  `*.mobile.golden.spec.ts`). Locale/timezone pinned en-US/UTC. Local-only by design
  (ADR-0011/0018); NOT in CI.
- CI `.github/workflows/ci.yml`: the `e2e` job (lines 112-130) runs `npx playwright
  install --with-deps chromium` + `npm run test:e2e` — chromium-only, explicitly **not**
  a required check. Only chromium-1228 is installed locally (no webkit/firefox binaries).
- 12 golden specs under `e2e/golden/`. **Precise (correction):** 11 match
  `*.golden.spec.ts` (desktop); only 1 (`mobile-flows.mobile.golden.spec.ts`) matches the
  mobile projects. Desktop browsers run 11, mobile projects run 1 — not "12 on each."

**PWA — already present (verify + polish, don't rebuild):**
- `vite.config.ts:13-49` — VitePWA `injectManifest`, own SW at `src/sw.ts`,
  `registerType:'autoUpdate'`, full manifest + 4 icons; `devOptions.enabled:true`.
- Icons in `public/`: favicon.svg, apple-touch-icon.png, pwa-192, pwa-512,
  pwa-maskable-512 (regenerable via `npm run gen:icons`). `index.html:7` viewport-fit=cover.
- `src/main.tsx` — `registerSW({ immediate: true })`.
- `src/sw.ts` — push + notificationclick + focusOrOpen deep-link + pushsubscriptionchange
  no-op. **Gap:** it binds `__WB_MANIFEST` but the comment says "we don't run a workbox
  runtime (no offline routing yet)" — the precache list is injected but nothing serves it,
  so the app does **not** actually open offline yet.
- Install UX: `src/features/onboarding/use-setup-guide.ts` captures the Chromium
  `beforeinstallprompt` (**~line 48 interface + 81-82 add/remove listeners**, correction —
  not 74-86) and auto-detects install context; `NotificationSettings.tsx` shows
  per-platform install tips.

**Safari/iOS surfaces (WebKit-in-Playwright can't fully cover):**
- Web Push: `src/features/notifications/use-push-subscription.ts` — VAPID subscribe/
  unsubscribe, `getKey()` over `toJSON().keys` for Safari, explicit handling of Safari's
  hollow-subscription bug (lines 120-130). iOS requires an **installed** PWA to receive
  push at all.
- **Pointer-drag grid (CORRECTED FILE):** the drag primitive is **`src/hooks/use-free-drag.ts`**
  (ADR-0004, raw Pointer Events) — it binds window-level `pointermove`/`pointerup`/
  `pointercancel` at **lines 195-197** (removed at 177-179) and computes normalized coords
  via `getBoundingClientRect` (line 156). There is **no `setPointerCapture` anywhere** in
  the tree — the window-listener path is exactly the cross-browser-fragile surface. It
  drives grid reposition, staging-tray placement, AND cluster drag-out, so a capture change
  there affects all three. (`use-grid.ts:72` is only a comment; the earlier "use-grid.ts:72-73"
  citation was wrong. `GridSurface.tsx:160-166` documents the reconciler dependency: the
  dragged card must stay in the same keyed array or the browser fires `pointerup` mid-drag.)
- SSE streaming: `src/features/ai/use-ai-chat.ts:108-147` — raw `fetch()` +
  `res.body.getReader()` + `TextDecoder` over `\n\n`-delimited `data:` frames. Safari
  fetch-streaming is the risk surface.
- iOS viewport: `BottomSheet.tsx` (100dvh + safe-area insets), `MobileBottomNav.tsx`,
  `GridSurface.tsx` 100vh math.
- Realtime is unused (ADR-0021) — no cross-browser Realtime surface to test.

### Workstreams

> **Reordered per verifier:** WS4 (rewrite `src/sw.ts` for offline) must land **before**
> WS3 (real-device push sign-off), or WS3's push + `focusOrOpen` verification has to be
> explicitly re-run after WS4 — editing the SW changes the installed PWA's update/activation
> path and invalidates the sign-off. Sequence: WS1 → WS2 → WS5 → **WS4 → WS3** → WS6.

#### WS1 — Add webkit + firefox to the CI smoke matrix · `S`
- [ ] **Install the browser binaries locally first:** `npx playwright install webkit firefox` (only chromium-1228 is present today; WS2 cannot start without them).
- [ ] In `playwright.config.ts` add `firefox` (`devices['Desktop Firefox']`) and `webkit` (`devices['Desktop Safari']`) projects alongside `chromium` (line 22).
- [ ] Update the `ci.yml` e2e job (line 126) to `npx playwright install --with-deps chromium firefox webkit`; keep the job non-required initially so a flaky WebKit run can't wedge `main`.
- [ ] Run `e2e/smoke.spec.ts` across all three; fix any sign-in-form render divergence (no DB, so failures are pure rendering/CSS/JS-support).
- [ ] Once green + stable across ~10 CI runs, promote `E2E (smoke)` to a required check via branch protection (owner action).
- **Files:** `playwright.config.ts`, `.github/workflows/ci.yml`
- **Done when:** CI e2e installs and passes `smoke.spec.ts` on chromium, firefox, webkit; Edge is documented as covered transitively by Chromium.

#### WS2 — Cross-browser golden suite (local) on webkit + firefox · `L`
- [ ] Confirm the webkit/firefox binaries are installed locally (WS1).
- [ ] Add `firefox` + `webkit` desktop projects to `playwright.golden.config.ts` mirroring the `chromium` project (testMatch `*.golden.spec.ts`, ignore `*.mobile.golden.spec.ts`, `dependencies:['setup']`, storageState).
- [ ] Add a `webkit-mobile` project (`devices['iPhone 14']` or `['iPhone 13']`) mirroring `chromium-mobile` to run `*.mobile.golden.spec.ts` on a real WebKit touch engine (closest proxy to iOS Safari).
- [ ] Run `npm run test:e2e:golden` per browser; triage failures. Highest-risk: grid-drag-interactions (window-pointer drag, no `setPointerCapture` — `use-free-drag.ts:195-197`), cluster, list-slider, chat (SSE `getReader` — `use-ai-chat.ts:134`).
- [ ] For any WebKit/Firefox drag flake, prefer a **code** fix (e.g. add `setPointerCapture` on pointerdown in **`src/hooks/use-free-drag.ts`** — the shared primitive, so the fix covers grid reposition, staging-tray placement, and cluster drag-out) over a test-only workaround, since the flake likely mirrors a real user bug.
- [ ] Keep the golden suite LOCAL-only (ADR-0011/0018); record a per-browser pass in the device checklist (WS6) instead of adding it to CI.
- **Files:** `playwright.golden.config.ts`, **`src/hooks/use-free-drag.ts`** (the corrected drag file; the `use-grid.ts` entry is superseded), `src/features/grid/GridCard.tsx`
- **Done when:** the 11 desktop golden specs pass on chromium/firefox/webkit AND the 1 mobile spec passes on chromium-mobile + webkit-mobile locally; any divergence is fixed in product code, not masked in the spec.

#### WS5 — Install-prompt + manifest polish across browsers · `S`
- [ ] Verify the Chromium `beforeinstallprompt` capture (`use-setup-guide.ts` ~48 + 81-82) fires on Chrome AND Edge; offer the deferred prompt somewhere persistent (e.g. Settings) for users who dismissed onboarding.
- [ ] Validate the manifest cross-browser: Chrome/Edge installability audit (Lighthouse PWA), Firefox manifest parsing, Safari apple-touch-icon + `display-mode:standalone`; confirm the maskable icon crops cleanly on Android adaptive icons.
- [ ] Confirm `theme_color`/`background_color` in the iOS splash + Android status bar; add `apple-mobile-web-app-*` meta to `index.html` only if a real gap is found.
- [ ] Add an Edge note to the support matrix (Chromium engine → same as Chrome; no separate Playwright project).
- **Files:** `src/features/onboarding/use-setup-guide.ts`, `index.html`, `src/features/notifications/NotificationSettings.tsx`
- **Done when:** Lighthouse "installable" passes; the install prompt is reachable on Chrome+Edge; Add-to-Dock/Home-Screen verified on Safari/iOS; icons render correctly in all installed contexts.

#### WS4 — Offline app shell (close the `injectManifest` gap) · `M`
- [ ] Add real precache serving to `src/sw.ts`: `precacheAndRoute(self.__WB_MANIFEST)` (replacing the current no-op bind) plus a `NavigationRoute` fallback to the precached `/index.html`.
- [ ] **Add a denylist so the `NavigationRoute`/precache does NOT intercept or cache Supabase auth-callback routes or API navigations** — a blanket `NavigationRoute→'/index.html'` can shadow the OAuth/magic-link redirect handling and serve a stale shell over an auth navigation. Exclude auth/API paths explicitly.
- [ ] **Add `workbox-precaching` + `workbox-routing` as explicit `devDependencies`** — they are present today only *transitively* via `workbox-build`/`vite-plugin-pwa` and are NOT in `package.json`; importing them from `src/sw.ts` relies on hoisting and breaks on a clean `npm ci`.
- [ ] Confirm the app shell boots offline and shows a graceful "offline/reconnect" state for data (TanStack Query `refetchOnReconnect` covers recovery); AI + network features degrade without breaking the no-AI invariant.
- [ ] **Guard the SW type-safety hole:** `src/sw.ts` is excluded from `tsconfig.app.json` and typechecked by nothing, so CI typecheck won't catch a bad workbox import — gate WS4 on a manual `build` + offline smoke, not just the offline behavior.
- [ ] Verify the autoUpdate flow still activates the new SW (`skipWaiting`/`clients.claim` already present) — test the update path explicitly so a stale precache can't serve an old shell after deploy.
- **Files:** `src/sw.ts`, `package.json`
- **Done when:** with the network offline, relaunching the installed PWA renders the full app shell (not the browser error page) on Chrome and Safari; auth navigations are not shadowed; online behavior unchanged.

#### WS3 — Real-Safari / real-iOS manual verification pass · `M`
> Runs **after** WS4 so the SW under test is the final offline-capable one.
- [ ] Deploy a preview build; install the PWA on a physical iPhone (Share → Add to Home Screen) and macOS Safari (File → Add to Dock).
- [ ] Verify Web Push end-to-end on the installed iOS PWA: grant permission, confirm a non-hollow `push_subscriptions` row, trigger a dispatch, tap the notification, confirm `focusOrOpen` deep-link routing (`sw.ts:62-82`). Re-test the Safari hollow-subscription recovery path on a **healthy, up-to-date** device (the bug is environmental — a wedged webpushd/old macOS — so a stale OS yields a false "push broken" conclusion).
- [ ] Verify pointer-drag on real iOS Safari touch (`touchAction:none` holds; no page scroll during drag; card doesn't drop mid-move — `GridSurface.tsx:160-166`) and macOS Safari trackpad.
- [ ] Verify SSE chat streams incrementally on real Safari (`use-ai-chat.ts:134`) — no full-response buffering; check the 503/429/413 pre-stream mappings still surface.
- [ ] Verify iOS viewport: no 100vh jump when the URL bar collapses (dvh), safe-area insets on notch devices, viewport-fit=cover letterbox-free.
- [ ] Log every defect as its own fix task; the deliverable is the verified checklist + any hotfix PRs.
- **Files:** `src/features/notifications/use-push-subscription.ts`, `src/sw.ts`, `src/features/ai/use-ai-chat.ts`, `src/features/grid/GridSurface.tsx`
- **New:** `docs/testing/ios-safari-manual-pass.md` (results log)
- **Done when:** a signed-off manual pass on ≥1 physical iPhone (installed PWA) + macOS Safari covering push, drag, SSE chat, and viewport with zero open blockers.

#### WS6 — Browser support matrix + device test checklist · `S`
- [ ] Write an explicit support matrix table: per browser × per surface (drag, push, SSE chat, offline shell, install, safe-area) with Supported / Best-effort / N-A.
- [ ] Write a repeatable device checklist: Chrome desktop, Edge desktop, Firefox desktop, Safari macOS, iOS Safari (installed PWA), Android Chrome (installed PWA).
- [ ] Cross-link from `docs/STYLE.md` / a new `docs/testing/` page and reference it from the golden-suite README.
- [ ] State the automated-vs-manual split clearly: Playwright (chromium/firefox/webkit) covers rendering + interaction; push-on-iOS and real-Safari SSE are manual-only.
- **New:** `docs/testing/browser-support-matrix.md`, `docs/testing/device-checklist.md`
- **Done when:** one doc states, per browser, what is supported and how it's verified, and the checklist is runnable by anyone before a release.

### Open decisions
- Golden suite cross-browser in CI, or stay local-only (ADR-0011/0018) with cross-browser proven manually per release? Recommendation: golden stays local; only smoke goes cross-browser in CI.
- Which WebKit-mobile device profile best proxies target iPhones (iPhone 14 vs 13 vs SE)?
- Offline scope: shell-only (WS4 as written) vs. also caching last-known task data for read-only offline viewing (larger, arguably a separate phase given refetch already covers reconnect).
- Firefox priority: is "renders + core interactions work" sufficient, or full feature parity? Recommendation: best-effort for Firefox, full parity for Chrome/Edge/Safari.
- Add a dedicated Settings-level install button, or is the onboarding card + browser-native affordance enough?

### Risks
- WebKit-in-Playwright is NOT iOS Safari — it shares the engine but not the push stack, exact touch model, or URL-bar/viewport behavior; passing golden specs on Playwright webkit does not prove iOS push or drag, so WS3's real-device pass is non-negotiable.
- The grid drag relies on window-level `pointermove` with no `setPointerCapture` (`use-free-drag.ts:195-197`, `GridSurface.tsx:160-166` remount warning) — the classic source of cross-browser drag divergence; Firefox/WebKit may drop/reorder pointer events differently and surface a real bug in WS2.
- Adding firefox+webkit to CI grows job time and flake surface — keep non-required until proven or `main` could wedge on a flaky WebKit run.
- Turning on real precaching changes SW caching semantics — a stale precache can serve an old shell after deploy if autoUpdate/skipWaiting isn't exercised.
- Safari's hollow-subscription failure is environmental — WS3 must test on an up-to-date OS or a false "push broken" conclusion is likely.
- iOS Web Push requires an installed PWA and has historically needed a fresh install after OS updates — onboarding must keep steering users to install-first.

### Depends on / feeds
- **Depends on** the live Web Push stack (ADR-0031, `use-push-subscription.ts`, `sw.ts`, VAPID env + server `web-push.ts`) — verifies and hardens it, does not build it. Must not reintroduce Realtime (ADR-0021).
- **Feeds** Phase 4 (iOS): WS3's installed-PWA + push baseline is the rung-1 foundation every higher native rung builds on; WS4's offline shell is a prerequisite for any later offline-data/background-sync work.

---

## Phase 3a — Pricing & payments (managed Pro tier)

**Goal:** Charge for a managed-AI "Pro" tier via Stripe while keeping Free (planner-only,
no AI) and BYO-AI (user's own key via MCP) free to the owner. Introduce a per-user
entitlement that gates the owner's Anthropic key behind an active paid subscription,
without weakening any guardrail and without breaking the "planner works fully without AI"
invariant.
· **Estimate:** L (~1.5–2.5 weeks; the Stripe function trio + webhook is the centerpiece;
legal/ops has real-world lead time that can gate go-live independent of code) ·
**Verifier verdict:** `needs-fixes` (grounded: **false** — the "single AI gate"
and "adminClient fenced to one caller" claims were both wrong; corrected below)

### Current state
- The metering/enforcement substrate already exists and is the natural place to bolt tier
  gating on. **Corrected: `precheck` is NOT the sole AI gate.** There are **three
  interactive callers** — `ai-chat/index.ts:83`, `plan-my-day/index.ts:45`, and
  `run-plan.ts:59` (the BabyClaw `generate_plan` tool) — and an entire **parallel gate**
  the draft missed: `guardrails-system.ts` exports `precheckForUser(admin, userId,
  feature)`/`recordUsageForUser`, used by `dispatch-messages/index.ts:170` for proactive
  AI (ADR-0031 morning plan + evening check-in). That path runs on the service-role
  `adminClient` with an explicit `p_user_id` (no `auth.uid()`), via the `*_for_user`/
  `*_system` RPCs. **Tier gating must cover both paths or it leaks.**
- Per-user monthly spend accrues in `ai_user_budget_ledger` behind DEFINER RPCs. There is
  **no** tier/entitlement/subscription/Stripe concept anywhere yet — AI availability is
  binary: every invited user is trusted on the owner's key.
- Proven patterns to mirror: owner-gated edge fn via `isOwner(user.id, OWNER_USER_ID)`
  (`_shared/owner.ts`); the service-role client `adminClient()` (`_shared/admin.ts`) —
  **corrected: it already has three callers (`redeem-invite`, `admin`,
  `dispatch-messages`); the source comment claiming "exactly one caller" is stale, and the
  webhook would be a fourth**; a PUBLIC no-JWT function gated by a signature/throttle
  (`redeem-invite`, `verify_jwt=false`, in the `deploy.yml:191` loop); origin-locked CORS
  (`_shared/cors.ts`); frontend `supabase.functions.invoke`; the owner-tunable singleton
  `app_config`.

### Workstreams

> **Critical ordering hazard (verifier):** WS2 (tier gating) blocks every non-owner
> lacking an active `pro` row, but that row is only ever written by WS3's webhook.
> Shipping WS2 before the webhook is live AND before the grandfather/seed decision is
> executed = an **instant managed-AI outage for every currently-invited user** (who get
> free AI today). **Gate the tier-block behind a feature flag enabled only once Stripe +
> the seed are in place, or ship WS1+WS2+WS3+seed atomically.**

#### WS1 — DB: subscriptions/entitlements table + write RPC + tier resolution · `M`
- [ ] Add migration `<ts>_subscriptions.sql` (pull `main` first — serialized). Table `public.subscriptions` keyed on `user_id uuid PK references auth.users(id) on delete cascade`; columns: `stripe_customer_id text unique`, `stripe_subscription_id text unique`, `tier text not null default 'free' check (tier in ('free','byo_ai','pro'))`, `status text not null default 'inactive' check (status in ('inactive','active','trialing','past_due','canceled','incomplete'))`, `current_period_end timestamptz`, `cancel_at_period_end boolean not null default false`, `updated_at timestamptz not null default now()`.
- [ ] Enable RLS; grant SELECT only to `authenticated`; policy `subscriptions_select_own using (user_id = auth.uid())`. NO insert/update/delete grants to app roles (mirror invites — writes never touch the public PostgREST surface).
- [ ] `SECURITY DEFINER` `subscription_upsert(p_user_id, p_customer, p_subscription, p_tier, p_status, p_period_end, p_cancel_at_period_end)` upserting on `user_id`; grant execute to service_role ONLY. Add `subscription_by_customer(p_customer)` for webhook resolution, service_role only.
- [ ] **Add `subscription_by_user(p_user_id)` DEFINER RPC (service_role) too (correction):** the proactive path (WS2) holds the service-role client with no `auth.uid()`, so it needs a userId-parameterized lookup — the draft only specced the customer lookup + the RLS self-select.
- [ ] Index `stripe_customer_id` and `stripe_subscription_id` for webhook lookups.
- [ ] Execute the seed decision (see Open decisions): grandfather existing invited users to a comped tier, or leave everyone `free`. Either way, the OWNER is never blocked — owner override is `isOwner` in code (env `OWNER_USER_ID`), never a seeded row.
- [ ] Write the down path (drop fns then table) in the migration header comment.
- **New:** `supabase/migrations/<ts>_subscriptions.sql`
- **Done when:** a user SELECTs only their own row under RLS; direct PostgREST INSERT/UPDATE is denied; `subscription_upsert` is callable only by service_role; `supabase db reset` applies cleanly and the down path reverses it.

#### WS2 — Tier gating in BOTH AI enforcement paths · `M`
- [ ] Extend `PrecheckResult` (`guardrails.ts:67`) with a new reason `'tier-required'`.
- [ ] Add `resolveEntitlement(client, userId): 'owner'|'pro'|'byo_ai'|'free'` — short-circuit to `'owner'` when `isOwner(userId, OWNER_USER_ID)`; else read the caller's own `subscriptions` row (tier/status/current_period_end), returning the effective tier only when status is active/trialing and the period isn't expired.
- [ ] In `precheck` (`guardrails.ts:74`), BEFORE the budget/rate checks, resolve entitlement; if not `('owner'|'pro')` return `{ ok:false, reason:'tier-required' }`. (`byo_ai` is blocked from the managed owner-key path — its AI runs through the separate MCP path.) **Thread `user.id` in from the callers (mandate, not option):** `ai-chat`/`plan-my-day`/`run-plan` already hold `user` from `requireUser`, so pass `user.id` rather than calling `client.auth.getUser()` inside the helper — avoids an extra auth round-trip on the AI hot path.
- [ ] **Add tier gating to `precheckForUser()` in `guardrails-system.ts` too (correction — the single biggest omission):** as drafted, gating only in `precheck()` means Free/non-owner users keep receiving managed-AI **proactive push** (morning plan + evening recap) — a direct leak of the paid owner-key AI to non-payers. The proactive path has no `auth.uid()`, so resolve entitlement via the new `subscription_by_user(p_user_id)` DEFINER RPC.
- [ ] Extend `AiStatus` (`getStatus`, `guardrails.ts:161`) with `tier` + an `entitled` boolean so the UI distinguishes "paused for budget" from "needs upgrade."
- [ ] No call-site control-flow changes needed — `ai-chat/index.ts:83` and `plan-my-day/index.ts:45` already branch on `precheck` ok/reason; map the new reason to a 402/403 with an "upgrade" slug.
- [ ] Add Deno unit tests to **both** `guardrails.test.ts` **and** `guardrails-system.test.ts` (free→blocked, pro-active→allowed, pro-expired→blocked, owner→allowed).
- **Files:** `supabase/functions/_shared/guardrails.ts`, `supabase/functions/_shared/guardrails-system.ts`, `supabase/functions/ai-chat/index.ts`, `supabase/functions/plan-my-day/index.ts`, `supabase/functions/_shared/run-plan.ts`, `supabase/functions/dispatch-messages/index.ts`, `supabase/functions/ai-status/index.ts`
- **New:** tier cases in `guardrails.test.ts` + `guardrails-system.test.ts`
- **Done when:** a `free` non-owner gets a clean upgrade-required response from ai-chat/plan-my-day AND receives no proactive managed-AI push (never reaches Anthropic on either path); a `pro`/active user passes through to the existing budget+rate guardrails; the owner is never blocked; ai-status returns tier + entitled; the planner with AI off is completely unaffected.

#### WS3 — Stripe edge functions: checkout, billing portal, webhook · `L`
- [ ] `_shared/stripe.ts`: construct the Stripe client from `Deno.env` `STRIPE_SECRET_KEY` using `npm:stripe` with the Web-Crypto fetch client (`Stripe.createFetchHttpClient()`); reference the key by name only, never log it. (The Node crypto path won't work under Deno.)
- [ ] `create-checkout-session/index.ts` (JWT-gated via `userClient`+`requireUser`, CORS via `_shared/cors.ts`): look up/create the user's Stripe customer (store `stripe_customer_id` via `subscription_upsert` / a small ensure-customer path using `adminClient`); create a Checkout Session `mode=subscription` with `STRIPE_PRICE_ID`, `success_url`/`cancel_url` from `ALLOWED_ORIGIN`, `client_reference_id = user.id`, `subscription_data.metadata.supabase_user_id = user.id`. Return `{ url }`. No publishable key in the bundle — checkout stays on web (avoids Apple IAP 15–30%).
- [ ] `create-billing-portal-session/index.ts` (JWT-gated): create a Billing Portal session for the caller's customer; return `{ url }`.
- [ ] `stripe-webhook/index.ts`: PUBLIC, no CORS, `verify_jwt=false`. Read the RAW body (`await req.text()`), verify with `stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET)` — reject 400 on bad signature. Resolve the user via `metadata.supabase_user_id`/`client_reference_id` (never by email); write via `subscription_upsert` through `adminClient()`. Idempotency/ordering: ignore events older than the stored `current_period_end`/`updated_at`; optionally record processed event ids.
- [ ] Register all three in `config.toml` with `verify_jwt=false`, and **add all three to the literal deploy loop at `deploy.yml:191`** (else they never deploy).
- [ ] Add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` to the edge-secret inventory (server-only; never in `.env.example` or the client bundle). Configure the Stripe webhook endpoint URL in the Stripe dashboard (manual owner step).
- **Files:** `supabase/config.toml`, `.github/workflows/deploy.yml`, `docs/SERVICES.md`
- **New:** `supabase/functions/_shared/stripe.ts`, `create-checkout-session/index.ts`, `create-billing-portal-session/index.ts`, `stripe-webhook/index.ts`, per-function `README.md`
- **Done when:** end-to-end in Stripe test mode — Upgrade opens hosted Checkout; a test payment fires `checkout.session.completed` + `customer.subscription.created`, the webhook verifies the signature and writes `tier='pro'`/active for the correct user; AI then works within the per-user budget; canceling in the Billing Portal fires `customer.subscription.deleted` and downgrades to free; a forged/unsigned webhook POST is rejected 400.

#### WS4 — Frontend: billing UI + tier-aware AI surfaces · `M`
- [ ] Extend `src/features/ai/use-ai-status.ts` `AiStatus` with `tier` + `entitled` (backward-compatible defaults).
- [ ] Add `src/features/billing/`: `useSubscription()` (RLS read via TanStack Query), `useStartCheckout()` → invoke `create-checkout-session` then `window.location = url`, `useManageBilling()` → `create-billing-portal-session`. Mirror the `use-admin.ts` invoke pattern.
- [ ] Add a Pricing/Upgrade hash route. **Concretely (correction — under-specified in the draft):** extend the `AppRoute` union in `src/lib/route.ts` (`'home'|'done'|'reminders'|'chat'|'admin'` → add one), plus `ROUTE_TO_HASH` and `hashToRoute()`, plus the `App.tsx` render switch. Post-checkout success/cancel URLs land on a hash route that invalidates the subscription + ai_status queries.
- [ ] Update `ChatConversation.tsx` and `PlanBox.tsx`: when the block reason is tier (not budget), show an "Upgrade to Pro" CTA; keep the existing "AI paused this month" copy for real budget exhaustion.
- [ ] Gate AI entry points (chat tab, Plan My Day button) so Free users see the upgrade path, not a dead call. The planner (grid/list/done/habits) stays fully functional regardless of tier.
- **Files:** `src/features/ai/use-ai-status.ts`, `src/features/ai/ChatConversation.tsx`, `src/features/ai/PlanBox.tsx`, `src/App.tsx`, `src/lib/route.ts`
- **New:** `src/features/billing/use-subscription.ts`, `use-checkout.ts`, `PricingView.tsx`, `README.md`
- **Done when:** a Free user sees an Upgrade CTA in the AI surfaces and can launch Checkout; after a successful test subscription the CTA becomes "Manage billing" and AI is usable; a genuinely budget-paused Pro user still sees the paused copy; with AI never opened the app behaves identically to today.

#### WS5 — Legal/ops prerequisites + ADR · `M`
- [ ] Split by trigger. **At public launch** (opening non-owner/public signup + collecting data beyond invite-only): publish Terms of Service + Privacy Policy; add static routes/pages + footer links; move hosting from Vercel Hobby (non-commercial) to **Vercel Pro** before any monetization.
- [ ] **At charging:** publish a refund/cancellation policy; stand up a business entity + bank account for Stripe payouts; enable Stripe Tax (or register for VAT/sales tax as thresholds require); rely on Stripe Checkout for SCA/3DS. Keep checkout strictly on the web to avoid Apple IAP 15–30% — never embed it in a native/app-store wrapper.
- [ ] Write ADR-0032 documenting the tier model (free / byo_ai / pro / owner-override), the Stripe Checkout+Billing+webhook architecture, the `subscriptions` table as the entitlement source of truth, and the gating points in **both** `precheck` and `precheckForUser`. Note it preserves ADR-0014/0015 and the no-AI-required invariant.
- [ ] Document new edge secrets in `docs/SERVICES.md`; update `docs/INVENTORY.md`/`ROADMAP.md` as they go stale.
- **Files:** `docs/SERVICES.md`, `docs/INVENTORY.md`, `docs/ROADMAP.md`
- **New:** `docs/adr/0032-pricing-managed-pro-tier.md`, `src/features/billing/legal/` (ToS + Privacy + Refund pages)
- **Done when:** ToS/Privacy/Refund pages are reachable and linked; ADR-0032 matches the shipped design; a launch/charging checklist (Vercel Pro, Stripe Tax, entity) is captured so nothing legal is a surprise at go-live.

### Open decisions
- Price point, billing interval (monthly/annual/both), and whether to offer a free trial (`trialing` is already in the schema).
- **Do existing invited users get grandfathered to a comped Pro/owner tier, or dropped to Free at cutover?** (Directly gates the WS2 enforcement flip — see the ordering hazard.)
- `past_due` behavior: hard-block managed AI immediately, or a short grace window?
- Is the `byo_ai`/MCP tier in scope for 3a (reserve enum only) or fully deferred to Phase 3b? Recommendation: reserve the enum now, implement the MCP path in Phase 1/3b.
- Enable Stripe Tax now vs. register manually later — depends on geography/volume.
- Keep invite-only signup alongside paid signups, or open public self-serve signup at launch (this is what triggers ToS/Privacy + Vercel Pro).
- Single Stripe Price/Product vs. a Product with multiple Prices (monthly/annual) — affects whether `STRIPE_PRICE_ID` is one value or a lookup.
- **Policy + comms for a paying Pro user blocked by Phase 0's global cap or the budget kill-switch** (refund/grace/messaging for "paid but capped") — an unowned cross-phase gap; settle before charging.

### Risks
- The webhook is the single source of truth for entitlement — a misconfig (`verify_jwt` not false, or missing signature verification) means either the webhook never runs or a forged POST grants Pro for free. Verify the signature on the RAW body; register the fn in both config.toml and the deploy loop.
- Stripe retries and delivers out of order — `subscription_upsert` must be idempotent and ignore stale events, or a late "deleted" clobbers a fresh "created."
- Owner override must be bulletproof: never charged/blocked — via `isOwner` in code, not a seeded row.
- Grandfathering: flipping the default to `free` silently disables AI for existing invited users unless seeded/comped — a deliberate decision, not a side effect.
- Stripe SDK on Deno must use the Web-Crypto fetch client + `constructEventAsync`.
- Service-role blast radius grows (the webhook is a fourth `adminClient()` caller) — keep writes behind the DEFINER upsert RPC, not raw table DML.
- Tax/VAT + business-entity requirements vary by jurisdiction and can block payouts if not set up before charging.
- The entitlement read inside `precheck` adds a DB round-trip on the AI hot path — keep it a single indexed own-row SELECT (or fold into `getStatus` caching).

### Depends on / feeds
- **Depends on** Phase 0's tier-gating substrate + `app_config` write path, and the guardrail/owner-gating/DEFINER-RPC patterns (no rework needed). **Depends on** Phase 1 having shipped the MCP path that the `byo_ai` enum points at (3a only reserves the enum).
- **Depends on / co-lands with** the public-launch gate (public signup, ToS/Privacy, Vercel Hobby→Pro) which is shared with Infra WS3/WS4.
- **Feeds** Phase 4: the Apple-IAP-vs-web billing decision here gates whether an App Store rung is even viable. The admin panel is a natural later home for a subscription roster/MRR view (optional follow-on).

---

## Phase 3b — Infra cutover & hardening (infrastructure)

**Goal:** Keep Todoclaw responsive and within budget as the user base grows from 5 → 500
→ 5000: break the serial hourly dispatcher into a parallel fan-out, add retention/pruning
to the append-only tables, and cut the managed tiers (Supabase Free → Pro, Vercel Hobby →
Pro) over before Free-tier ceilings force an outage — sequenced against the tier triggers.
· **Estimate:** ~2 weeks (WS1 fan-out is the load-bearing ~1 week; WS2 ~2-3 days; WS3
~1-2 days; WS4 ~1 day) · **Verifier verdict:** `needs-fixes` (grounded: **false** — the
"history is permanent" and "4-function deploy loop" claims were wrong; corrected below)

### Current state
- **Dispatcher (the acute bottleneck):** `dispatch-messages/index.ts` is one `Deno.serve`
  handler that loops candidates **strictly serially** — `for (const c of candidates)` at
  `index.ts:80`. Per user it awaits, in sequence: `dispatch_inputs_for_user` (`:89`),
  `claim_message` (`:115`), `maybeGeneratePlan` (a synchronous multi-second Anthropic call,
  `:134,162-191`), then `pushToUser` which itself loops every subscription serially issuing
  one `sendWebPush` POST each (`:199-228`, loop at `:215`). All inside a SINGLE invocation,
  triggered hourly by `.github/workflows/notify.yml` (`0 * * * *`) via `curl --max-time 60`
  — so the whole batch must finish within the curl + edge-fn wall clock. `verify_jwt=false`
  (`config.toml:436`). At ~500-2k due users in one local-morning hour × ~1-3 s Anthropic
  each, the serial loop cannot finish in time.
- **Idempotency is already solid:** `claim_message` is an atomic `insert … on conflict do
  nothing returning id` behind `unique(user_id, local_date, kind)`, so overlapping/retried
  runs never double-send or double-charge — this is what makes a parallel fan-out safe.
- **`notification_candidates()` already exists (correction):** a service_role-only
  `SECURITY DEFINER` RPC (`20260707150000_dispatch_rpcs.sql:31`, revoked from public)
  returning `{user_id, timezone, notifications}` filtered by `notifications.enabled` AND
  has-subscription. `dispatch_tick()` should build on this, not reinvent the filter.
- **Unbounded append-only tables (all already indexed):**
  - `history` — 1 row per completion. Index `history_user_completed_at_idx`.
    **Corrected: it is NOT immutable.** Migration `20260705000000_history_delete_policy.sql`
    adds `grant delete on public.history to authenticated` + policy `history_delete_own
    (user_id = auth.uid())`; CLAUDE.md itself states this. The "permanent-by-design
    contract" is stale — history is grow-forever only because user deletes are rare, not
    because deletion is contractually forbidden. The "breaking the permanent contract" risk
    is largely moot.
  - `ai_usage` — 1 row per AI request. The rate-limit `count(*)` over a trailing hour/day
    window is per-user and served by its composite index, so query cost stays flat — the
    problem is pure storage growth. No delete grant.
  - `invite_attempts` — 1 row per redeem attempt. RLS-on with no grants/policies; reachable
    only via the DEFINER `invite_throttle`. "Stale rows are harmless" for correctness, not
    for storage.
  - `messages` — 2 rows/user/day (plan+recap), forever.
- **Tier posture:** Supabase Free "pauses/read-only at limits, never bills"; `keepalive.yml`
  daily ping defeats the ~7-day inactivity pause; `backup.yml` does a daily `pg_dump`.
  Vercel Hobby "pauses, never bills." Only Anthropic bills, bounded by the $20/mo global +
  $10/mo per-user kill-switch. All scheduled jobs run only from `main`.

### Workstreams

> **Sequencing note (correction):** pg_cron + pg_net are available on **Supabase Free**, so
> WS1 is NOT blocked by the WS3 Pro upgrade — "WS3 before WS1" is a headroom/cost choice,
> not a hard dependency, and WS1 can proceed on Free. Recommended order: WS2 + WS3 first
> (cheap, buy headroom, remove the pause risk at the ~50-200-user Free ceiling), then WS1
> before the ~500-2k dispatcher wall, with WS4 monitoring landing alongside WS3.

#### WS1 — Dispatcher fan-out: parallel per-user invocations, move the tick off GitHub Actions · `L`
- [ ] Split the per-candidate body of `dispatch-messages/index.ts:80-153` into a NEW single-user edge function `dispatch-user` that accepts `{user_id, kind, local_date}` + the `x-dispatch-secret` header and runs exactly the inputs→claim→maybeGeneratePlan→pushToUser sequence for ONE user (reuse `_shared/dispatch.ts`, `run-plan.ts`, `web-push.ts` unchanged; add `[functions.dispatch-user] verify_jwt = false` to config.toml).
- [ ] **Add `dispatch-user` to the literal deploy loop at `deploy.yml:191` (correction — explicit WS1 step, not just a cross-phase note):** it is a hardcoded 7-function list (`ai-status plan-my-day ai-chat dispatch-messages generate-invite redeem-invite admin`), not a glob, so `dispatch-user` silently will not deploy otherwise. Also run `supabase secrets set DISPATCH_SECRET` for it, and add a deploy-time preflight (like the ai-status unauth-401 check at `deploy.yml:198-212`) confirming the 403 gate works post-deploy.
- [ ] Add a migration enabling `pg_cron` + `pg_net` (use `create extension if not exists` and coordinate with WS2, which also enables pg_cron, so the two migrations don't conflict). Add a DEFINER `dispatch_tick()` that (a) selects due users — **build on the existing `notification_candidates()` RPC** and push the localHour/quiet-hours math from `_shared/dispatch.ts` (`localHourInTZ`/`dueKind`) into SQL, and (b) for each due user issues `net.http_post(dispatch_user_url, headers with x-dispatch-secret, body {user_id,kind,local_date})`. pg_net queues them async → N users fire concurrently.
- [ ] **Solve the secret-in-DB boundary (correction — the one real security gap):** pg_net's POST must carry `x-dispatch-secret`, so `dispatch_tick()`/the cron job needs the URL + secret at the DB layer. A committed migration MUST NOT hardcode the secret (Hard Rules 2 & 3) — use **Supabase Vault** (`vault.decrypted_secrets`) or an out-of-band-populated config table. Acknowledge in the ADR that this NEWLY places the dispatch secret inside the DB (visible to postgres/service_role via `cron.job`), whereas today it lives only in GitHub Actions secrets + the function's env.
- [ ] Add a concurrency/rate throttle on the morning burst (critical): batch the pg_net posts (e.g. LIMIT/OFFSET waves per minute via a small `dispatch_wave` cron, or a semaphore table) so 500-2k simultaneous plan generations don't blow the Anthropic account concurrency limit or spike the $20 budget in one minute. `precheckForUser` still enforces spend, but **concurrency** needs shaping.
- [ ] Schedule `dispatch_tick()` hourly via `cron.schedule` in the migration; keep hour granularity (the inbox covers misses).
- [ ] Add a lightweight `dispatch_runs` audit row (users_due, posted, failed) so failures are visible without Realtime.
- [ ] **Retire `notify.yml` only after prod verification (correction — make it conditional):** keep its schedule live through the entire pg_cron bake-in; reduce it to a `workflow_dispatch` monitored fallback only once the fan-out is verified in prod. Update `docs/INVENTORY.md` §4a + `docs/SERVICES.md` "Proactive notifications."
- **Files:** `supabase/functions/dispatch-messages/index.ts`, `supabase/config.toml`, `.github/workflows/notify.yml`, `.github/workflows/deploy.yml`, `docs/INVENTORY.md`, `docs/SERVICES.md`
- **New:** `supabase/functions/dispatch-user/index.ts`, `supabase/migrations/<ts>_dispatch_fanout.sql`
- **Done when:** with N synthetic due users, one hourly tick posts N parallel `dispatch-user` invocations that each finish well under the wall clock; a 500+ due-user run completes inside the hour with no timeout; re-running the tick sends nothing new (claim dedupe holds); Anthropic concurrency stays within account limits; the budget kill-switch still trips under burst.

#### WS2 — Retention / pruning for the append-only tables · `M`
- [ ] Add a migration with pg_cron-scheduled DEFINER prune functions (a postgres-owned job bypasses the missing app-role DELETE grants — no new grants exposed). Prune: `ai_usage` older than the max rate window + margin (e.g. 30 days); `invite_attempts` older than the throttle window + margin (e.g. 7 days); `messages` older than a retention horizon (e.g. 180 days — the inbox is the source of truth but need not be infinite).
- [ ] For `history`: it IS deletable (owner-scoped, per the correction), so pruning no longer conflicts with an immutability contract — but it is still user-visible completion history, so any horizon is a **product** decision. Choose (a) a long retention prune (e.g. 2 years) or (b) monthly range partitioning by `completed_at` for cheap detach/archive. Flagged in Open Decisions.
- [ ] **Add a standalone btree on each pruned timestamp (correction — effectively required, not optional):** the composite indexes lead with `user_id` (ai_usage, history) or `ip` (invite_attempts), so a global `delete where called_at < X` won't use them and will seq-scan.
- [ ] Schedule the prune functions off-peak (e.g. daily 03:00 UTC) in the same migration; coordinate the `create extension if not exists pg_cron` with WS1.
- [ ] Document retention horizons in `docs/ARCHITECTURE.md` / the migration comments.
- **Files:** `docs/ARCHITECTURE.md`, `docs/INVENTORY.md`
- **New:** `supabase/migrations/<ts>_retention_pruning.sql`
- **Done when:** a scheduled prune removes rows past each horizon on a seeded table; rate limiting, invite throttle, and inbox all still behave; DB growth flattens under synthetic load; the history retention/partition choice is applied and documented.

#### WS3 — Supabase Free → Pro cutover · `M`
- [ ] Upgrade the project to Pro; enable the org Spend Cap (keeps the "never surprise-bills" posture) and pick a compute add-on. **Defer the compute-size decision until WS1's fan-out load profile is known (ordering correction)** — sizing before the morning-burst CPU shape is measured is guesswork; either land a WS1 load test first or size conservatively and revisit.
- [ ] Turn on Pro daily backups + evaluate the PITR add-on; then decide the fate of `backup.yml` (keep as an encrypted off-platform copy, or retire). If keeping, note the session-pooler `postgres`-user caveat and that Pro + the IPv4 add-on unblocks least-privilege `backup_ro`.
- [ ] **Retire `keepalive.yml` only after Pro is confirmed active (correction — conditional):** its entire reason to exist (the ~7-day pause) is gone on Pro, but a paused prod project mid-cutover is an outage. Sequence strictly: Pro live → verified → remove the schedule.
- [ ] Update `docs/INVENTORY.md` §2/§5 and `docs/SERVICES.md` (Keep-alive, Billing & cost alerts) to reflect Pro (no pause, managed backups, spend cap).
- [ ] Verify prod still green after cutover: migrations still apply via deploy.yml, functions still deploy, AI CORS lock unchanged.
- **Files:** `docs/INVENTORY.md`, `docs/SERVICES.md`, `.github/workflows/keepalive.yml`, `.github/workflows/backup.yml`
- **Done when:** the project runs on Pro with Spend Cap on and a compute add-on chosen; no inactivity pause possible; managed daily backups verified; keepalive retired (or documented why kept); docs reconciled; a smoke check confirms API, deploy pipeline, and AI endpoints all still work.

#### WS4 — Vercel Hobby → Pro cutover + tier-trigger monitoring · `S`
- [ ] Upgrade the frontend to Vercel Pro (primary driver: the Hobby non-commercial ToS once there are real external users, plus bandwidth headroom); confirm build/output + env vars carry over; enable Vercel Spend Management dollar caps/alerts (Pro-only).
- [ ] Establish tier-trigger monitoring: track Supabase DB size, egress, compute (dashboard → Usage) and Anthropic month-to-date spend; wire the existing owner admin panel / `AI_SPEND_ALERT_WEBHOOK_URL` as the alerting surface.
- [ ] Write down the trigger thresholds: cut Supabase→Pro before Free DB/egress/compute ceilings bite (~50-200 users, driven by history/ai_usage/messages storage + sustained compute); ship the dispatcher fan-out before the serial loop can't clear the hour (~500-2k due users). Put the ladder in `docs/INVENTORY.md` §5.
- [ ] Update `docs/INVENTORY.md` §2 Vercel row + §5 to Pro.
- **Files:** `docs/INVENTORY.md`, `docs/SERVICES.md`
- **Done when:** the frontend is on Vercel Pro with spend alerts on; a documented, monitored trigger ladder (user-count/storage/compute → action) lives in INVENTORY.md; the owner is alerted before any Free/Hobby ceiling or the dispatcher window is breached.

### Open decisions
- Fan-out substrate: pg_cron+pg_net direct-to-edge-function (recommended, lowest new surface; but no retries) vs. pgmq queue + worker (durable, adds a drain worker) vs. a dedicated queue table + polling worker.
- Due-user selection: push localHour/quiet-hours math into SQL (clean, risks TS-parity drift) vs. enqueue all candidates hourly and let each `dispatch-user` no-op when not due (simpler SQL, wasteful invocations).
- `history` retention: keep permanent (unbounded growth on Pro storage), long-horizon prune (e.g. 2 yr), or range-partition by `completed_at` and archive old partitions. Owner call.
- Concrete retention horizons for ai_usage / invite_attempts / messages (proposed 30 / 7 / 180 days) — owner sign-off.
- Keep or retire `backup.yml` once Pro managed backups + PITR are on; and whether to take the Pro IPv4 add-on to restore least-privilege `backup_ro`.
- Vercel Pro timing — Hobby commercial-use ToS (as soon as there are real external users) vs. bandwidth headroom (later). Determines whether WS4 leads or trails.
- Supabase compute add-on size at the 500-user tier (blocked on WS1's load profile).

### Risks
- Morning-burst thundering herd on Anthropic: fanning 500-2k plan generations into one hour can exceed the account's concurrency/rate limits and race the kill-switch — `precheckForUser` bounds spend but NOT concurrency, so WS1 must add wave/semaphore throttling or the fan-out trades a timeout for rate-limit errors.
- pg_net is fire-and-forget: a failed `http_post` has no auto-retry and limited visibility — mitigated by claim idempotency (re-tick is safe) + the `dispatch_runs` audit, but a silently-dropped post means no message that hour (inbox-on-next-load still covers the user).
- Moving the localHour/quiet-hours math from TS into SQL risks behavior drift from the tested TS path — needs parity tests or the enqueue-all-and-noop alternative.
- Scheduled jobs run only from `main` and pg_cron/pg_net must be enabled — a misconfigured extension or unset dispatch-user URL/secret silently stops all proactive messages with no red CI signal.
- Compute add-on undersizing raises API latency for the whole app, not just dispatch.

### Depends on / feeds
- **Cross-couples with Phase 0:** the fan-out's morning burst stress-tests the budget/rate guardrails (`guardrails-system.ts`, `app_config` live caps) and any per-request concurrency limit — the two must agree on how concurrency (not just spend) is bounded. Pruning horizons (WS2) must preserve the current-month spend window Phase 0's cap + active-user logic read.
- **Shares the Vercel Hobby→Pro move** with Phase 3a (one cutover, two triggers) and the "go public" gate.
- **Inherits the deploy.yml dependency:** `dispatch-user` must be added to the literal loop. Migration serialization applies (WS1 + WS2 each add one). Realtime stays deferred (ADR-0021).

---

## Phase 4 — Go native (iOS, separate project)

**Goal:** Decide IF and HOW Todoclaw goes native on iOS via a four-rung ladder (PWA →
Capacitor → React Native/Expo → Swift/SwiftUI), with the reuse fraction, cost, and unlock
at each rung. **This is a scoping section, not a build plan** — the deliverable is a
go/no-go decision framework. The forcing function for going past rung 1 is native Apple
Reminders/EventKit, which only full Swift (rung 4) can deliver; everything short of that
is an App Store distribution/notification play on top of the existing web app.
· **Estimate:** Scoping work itself is `S` (a few days to write the framework, no code).
The rungs, if pursued: rung 1 done (~0); rung 2 `M`; rung 3 `L`; rung 4 `L`+ ·
**Verifier verdict:** `needs-fixes` (grounded: **false** — the "backend 100% reused"
claim is false for push; corrected below)

### Current state
- **Pure, portable logic (rungs 3+ reuse the algorithms; rungs 1-2 reuse verbatim):**
  `src/lib/` is pure TypeScript with zero React/DOM imports — verified across scoring.ts,
  clustering.ts, collision.ts, dates.ts, quadrants.ts, recurring.ts, etc. (only
  `src/lib/route.ts:1` imports React, via `useSyncExternalStore`). `taskScore =
  x*0.45 + y*0.55 + (daysUntil<=2?0.18:0)` at `scoring.ts:49-55`; seed-based
  non-transitive clustering (`computeClusters`, `CX=0.09/CY=0.07`) at `clustering.ts:15-62`.
  In JS rungs (1,2,3) this ships as-is; a Swift rung (4) re-ports it (a translation guided
  by `planning/EISENCLAW-LOGIC-TO-PORT.md`, but a rewrite + fresh test suite).
- **The signature UI = the whole lift (only rungs 1-2 reuse it; rungs 3-4 rewrite it):**
  the free-canvas drag grid is React + DOM + raw Pointer Events + CSS.
  `src/hooks/use-free-drag.ts` is the drag primitive (ADR-0004; binds window
  pointermove/up/cancel, computes coords via `getBoundingClientRect`). On top sit
  `use-grid.ts` (391 lines of React state), `GridSurface.tsx` (307 lines; reconciler note
  at 160-166), `GridCard.tsx`, `GridCanvas.tsx`, `GridAxes.tsx`, `PawTrail.tsx`. None
  survives a move to native gestures — rungs 3-4 reimplement drag, clustering hit-testing,
  cluster bubbles/popups, and the aspect-locked canvas.
- **Backend reuse (CORRECTED — not 100%):** the client is a thin Supabase layer
  (`src/lib/supabase.ts` = `createClient(url, anonKey)`, RLS as the real guard). Auth, RLS,
  and the edge functions are transport-agnostic and carry over — **except push.**
  `dispatch-messages` sends **VAPID Web Push only** (`_shared/web-push.ts`, `VAPID_*` env,
  `push_subscriptions_for_user` RPC). An iOS WKWebView (Capacitor rung 2) **cannot receive
  Web Push**, and native rungs use **APNs** — so the entire push-delivery layer is NOT
  reused. Rung 2's "APNs shim" is not a thin client shim: it needs a new **server-side
  APNs sender** (auth key/topic) plus a **device-token store** (new table/column + RLS)
  alongside the web-push subscriptions table. **Push reuse ≈ 0%, not 100%.**
- **Rung 1 (PWA) is already delivered:** `public/` ships the PWA + apple-touch icons, the
  SW is at `src/sw.ts`, and web push is live in prod (ADR-0031). The installable, push-capable
  iOS experience exists today at ~100% reuse — the ladder starts one rung up.
  **(Reconciling the internal inconsistency:** rung 1 is shipped/live today; Phase 2
  *hardens and verifies* it — offline shell, cross-browser, real-device push — it does not
  build it. So "depends on Phase 2" means depends on Phase 2's reliability work, not on
  Phase 2 to deliver the PWA.)
- **The EventKit forcing function:** an Apple Reminders integration was designed and
  benched because there is no Reminders REST API — a PWA can only do a Shortcut→ingest
  workaround; true two-way sync requires native EventKit, i.e. rung 4.

### Workstreams (all produce written decisions, not code)

#### Rung 1 — PWA (baseline, already shipped): document the reuse ceiling · `S`
- [ ] Write down that rung 1 is DONE: installable PWA + SW + web push in prod; ~100% reuse, $0, no App Store.
- [ ] Enumerate the hard iOS-Safari PWA ceilings that motivate climbing: no App Store presence/discoverability, web-push reliability quirks on iOS, no EventKit/Reminders, no native share-sheet/widgets/Siri.
- [ ] Decide whether PWA polish (offline cache tuning — see Phase 2 WS4, add-to-homescreen prompt, iOS splash icons) is enough for the current invite-only audience — if yes, STOP HERE.
- **Files:** `src/sw.ts`, `vite.config.ts`, `public/apple-touch-icon.png`
- **Done when:** a one-page statement of what the shipped PWA covers and the exact capabilities it cannot reach, such that the reader can judge whether any further rung is justified.

#### Rung 2 — Capacitor wrap: App Store listing + native APNs, thin-wrapper review risk · `M`
- [ ] Scope wrapping the existing Vite build in Capacitor: same React app in a WKWebView. **Reuse is below the naive "~95%" (correction) once push is counted** — all of `src/` + UI reuse verbatim, but the entire push-delivery layer is new server work.
- [ ] **Surface the server-side APNs path as a rung-2 prerequisite, not an afterthought artifact:** an APNs sender in an edge function (or extend `dispatch-messages`), an APNs auth key as a server-only secret, and a device-token table with RLS (`user_id = auth.uid()`). This is what lets rung 2 clear Guideline 4.2 with "native APNs" as the genuine native value.
- [ ] Identify what else genuinely upgrades vs the PWA: App Store distribution, native share/haptics via Capacitor plugins.
- [ ] Flag the Apple review risk: Guideline 4.2 rejects thin web wrappers with no native value — mitigate by bundling at least one real native capability (APNs, share, or a widget).
- [ ] **Address native auth session handling (missing step):** `supabase-js` on a native shell needs secure token persistence (iOS Keychain) + deep-link/redirect handling for the auth callback (magic-link/OAuth) — not free reuse.
- [ ] List the mechanical costs: $99/yr Apple Developer account, Xcode build/signing, a Mac in CI or manual archive+upload, the Capacitor iOS project in-repo or a sibling repo.
- **New:** `capacitor.config.ts`, generated `ios/` project, the server-side APNs sender + device-token table, an APNs registration shim
- **Done when:** a written go/no-go on Capacitor stating the (push-adjusted) reuse fraction, the single native feature that clears Guideline 4.2, the new server-side APNs work, and the recurring cost — enough to green-light a spike.

#### Rung 3 — React Native / Expo: share `src/lib`, rewrite the grid natively · `L`
- [ ] Scope a new Expo app importing the pure `src/lib/` algorithms as a shared package, keeping the Supabase backend via `supabase-js`, but REWRITING the entire grid interaction against react-native-gesture-handler/Reanimated.
- [ ] Quantify the rewrite surface: `use-free-drag.ts`, `use-grid.ts`, GridSurface/GridCard/GridCanvas/GridAxes/PawTrail, cluster bubble/popup, and the mobile tap-to-place path — none port, all reimplement.
- [ ] **Define the shared-package versioning contract (missing step):** how `@todoclaw/logic` (extracted from `src/lib`, with its Vitest suite as the parity oracle) is versioned against the web app so the two UIs don't drift on scoring/clustering constants.
- [ ] Assess whether RN buys anything rung 2 doesn't, given EventKit still needs a native module either way — RN's main win is native-feeling drag/animation at the cost of a second UI codebase forever.
- **Files:** `src/lib/scoring.ts`, `src/lib/clustering.ts`, `src/lib/collision.ts`, `src/lib/recurring.ts`, `src/hooks/use-free-drag.ts`, `src/features/grid/use-grid.ts`
- **New:** a separate Expo/RN app, the `@todoclaw/logic` workspace package, a native gesture-based grid
- **Done when:** a written assessment naming exactly which files are reused vs rewritten, concluding whether native-quality gestures alone justify a permanent second UI codebase (vs jumping to rung 4).

#### Rung 4 — Full Swift/SwiftUI: the only EventKit/Reminders unlock · `L`+
- [ ] Scope a ground-up SwiftUI app: re-port `src/lib` to Swift (guided by `planning/EISENCLAW-LOGIC-TO-PORT.md` + the Vitest tests as the spec), rebuild the free-canvas grid with SwiftUI gestures/Canvas, talk to Supabase via supabase-swift.
- [ ] State the unique unlock plainly: the ONLY rung that can do native EventKit two-way Apple Reminders sync (the benched integration), plus WidgetKit, Siri/Shortcuts, Live Activities, best-in-class drag.
- [ ] **Reassert the service-role boundary for the new client (missing step):** supabase-swift ships the ANON key only (RLS as guard), never service_role.
- [ ] Cost it honestly: a full second implementation of both logic (re-ported + re-tested with a mirrored suite against the Vitest oracle) and UI, Swift expertise, ongoing dual-platform maintenance; backend still reused (minus the APNs server work already built for rung 2).
- [ ] Define the trigger: pursue rung 4 only if native Reminders/EventKit (or widgets/Siri) is a committed product requirement — otherwise it is strictly dominated by rung 2 for distribution and rung 1 for cost.
- **Files:** `src/lib/scoring.ts`, `src/lib/clustering.ts`, `planning/EISENCLAW-LOGIC-TO-PORT.md`
- **New:** a separate Swift/SwiftUI project, the Swift re-port + mirrored test suite, the EventKit sync module, the supabase-swift integration layer
- **Done when:** a written statement that rung 4 is gated behind a concrete EventKit/native-integration product requirement, with the reuse boundary (backend reused, logic re-ported, UI rebuilt, push already APNs) spelled out.

#### Cross-cutting decision points (account, auth, IAP, review) · `S`
- [ ] Apple Developer Program: $99/yr, required for any App Store rung (2,3,4); not needed for rung 1.
- [ ] Sign in with Apple: Guideline 4.8 requires offering it if any third-party/social login is offered — reconcile with the current invite-only auth (ADR-0014/0030) before listing.
- [ ] Apple IAP: if Phase 3a introduces paid tiers, in-app digital purchases on iOS must use Apple IAP (15-30% cut) — a hard interaction between Phase 3a monetization and any App Store rung; web-only billing avoids it but Apple restricts steering.
- [ ] App Store review latency/rejection: thin-wrapper (4.2) and Sign-in-with-Apple (4.8) are the two most likely rejections; budget review cycles.
- **Done when:** a decision checklist capturing the $99 account, the Sign-in-with-Apple obligation vs invite-only auth, and the explicit Phase 3a IAP interaction, so none is discovered late.

### Open decisions
- Is native iOS even in scope, or is the shipped PWA (rung 1) sufficient for the invite-only audience indefinitely?
- Is native Apple Reminders/EventKit sync a committed requirement? If yes, the ladder collapses to "go to rung 4"; if no, rung 2 dominates.
- If distribution alone is the goal, is rung 2 (Capacitor) acceptable, or is the thin-wrapper risk a dealbreaker?
- How does Phase 3a intend to bill on iOS — Apple IAP vs web-only — since that gates whether an App Store listing is viable?
- Same-repo (monorepo with a shared `@todoclaw/logic` package) vs separate native repo — affects how `src/lib` is extracted and versioned.
- Who owns/maintains the second codebase, given Braeden is solo and this is a first Claude Code project — is dual-platform maintenance realistic?
- **Which mobile UX does the native rung reimplement?** Rung 3/4 grid-rewrite scoping assumes the free-canvas grid is the native target, but current mobile ships a reinterpreted list/tap-to-place UX (per the mobile-redesign direction). Clarify before quantifying the rewrite surface.

### Risks
- Thin-wrapper rejection (Guideline 4.2) for a Capacitor build with no genuine native feature — must bundle native APNs (or share/widget).
- Dual-codebase maintenance debt: rungs 3-4 create a second UI that must track every future web feature; the free-canvas grid is the most churn-heavy surface, so drift is likely.
- Swift re-port parity risk: re-porting scoring/clustering can silently diverge from the canonical TS (non-transitive clustering, DST-safe `daysUntil`) — needs a mirrored test suite against the Vitest oracle.
- Sign-in-with-Apple vs invite-only: App Store distribution may force Guideline 4.8, which doesn't obviously fit the invite-code auth model.
- Phase 3a IAP collision: paid tiers + App Store presence trigger Apple IAP rules (30% cut, anti-steering) — a Phase 3a monetization decision constrains the iOS distribution choice.
- Owner-key AI cost surface: a native app widens usage on the single owner Anthropic key; the ADR-0015 guardrails hold server-side, but a successful App Store launch could hit the kill-switch faster than the invite-only web app.

### Depends on / feeds
- **Depends on** Phase 2's delivered PWA/web-push rung-1 baseline (hardened, not built there) and Phase 3a's Apple-IAP-vs-web billing decision (must be settled before an App Store rung). **Depends on** the stable, client-agnostic backend contract (Supabase RLS + edge functions) reused at every rung, and on `planning/EISENCLAW-LOGIC-TO-PORT.md` + the `src/lib` Vitest suite as the Swift re-port oracle.
- **Feeds** nothing downstream — this is the terminal, decision-only phase.

---

## Gaps not owned by any phase

These fell through the cracks — each phase punts them to "optional" or "surface through
existing," so nobody actually owns them. Assign an owner before the relevant phase ships.

- **Consolidated owner observability/admin dashboard** — per-model spend, per-user spend,
  active-user count (Phase 0 "surfaces" it), MRR/subscription roster (Phase 3a "optional
  follow-on"), tier-trigger monitoring (Infra "surface through existing"). Every phase
  assumes the unified view already exists; none builds it.
- **Concurrency bounding of the owner's single Anthropic key** (per-key RPM/TPM). Infra
  flags the fan-out burst stress-tests it, but neither Phase 0 (spend-focused) nor Infra
  owns building an actual concurrency limiter — only spend caps exist.
- **Public self-serve signup mechanics** — Phase 3a names opening signup as a ToS trigger
  and a decision, but the real auth work (email verification, abuse/rate-limit on
  registration, Sign in with Apple reconciliation for Phase 4) is a workstream in no phase.
- **"Paid but capped" policy + comms** — a paying Pro user blocked by Phase 0's global cap
  or the budget kill-switch. The Phase 0 cap and the Phase 3a paid promise conflict
  directly; refund/grace/messaging is owned by no phase.
- **Existing-invited-user entitlement backfill** at the pricing cutover — grandfather-to-
  comped vs drop-to-Free is a Phase 3a *decision*, but the actual migration for current
  users is not a workstream.
- **User-facing account deletion + data export** — Infra prunes *system* tables and Phase
  3a adds legal pages, but the delete-my-account / export-my-data mechanism that paying
  public users + a real Privacy policy require exists nowhere.
- **Prompt-cache-prefix stability as an enforced invariant** — Phase 0 introduces the
  static/volatile split and notes future prompt edits must preserve it, but no phase owns a
  regression test that fails when a prompt change breaks the cache prefix's byte-stability.
- **Abuse surface of new public/open endpoints** beyond the happy path — MCP OAuth Dynamic
  Client Registration (open registration), token issuance, Stripe checkout. Each phase
  rate-limits its own feature, but the open-DCR abuse vector and webhook dunning/
  reconciliation (past_due sweeps, failed-delivery replay) are not clearly owned.
- **`deploy.yml` pipeline ownership** — Infra flags that new functions must be added to the
  literal auto-deploy loop, but no phase owns updating and testing the pipeline for the full
  set (mcp, dispatch-user, stripe-*), leaving a silent manual-deploy footgun.
- **Load/scale validation of the fan-out** at the 500→5000 tier — Infra builds it but there
  is no owned load-test / synthetic burst harness to prove the parallel dispatcher and
  guardrails hold before real growth.

---

## Verification summary

Every phase came back `needs-fixes`; the corrections below are already folded into the
workstreams above. "Grounded" is the verifier's judgment on whether the *initial* research
was faithful to the code — a `false` means a load-bearing citation was wrong and has been
corrected here.

| Phase | Verdict | Grounded | Key corrections applied |
|---|---|---|---|
| **0 — cost-opt** | needs-fixes | true | The $0.20 per-call SQL clamp under-counts Opus (fix model-aware clamp / lower MAX_TOKENS / drop Opus); the system path (`dispatch-messages` + `ai_budget_add_for_user`) needs the same model-aware treatment; "auto-scaling" is really a manual-ceiling model (clamped to $20 until the owner raises it); make new `parseConfig` keys optional; confirm real model ids/pricing before writing the migration; breaking test updates land with WS3/WS4, not WS7. |
| **1 — mcp** | needs-fixes | true | `guardrails-config.ts` `buildConfig` only spreads `chat`+`plan_my_day` limits, so an owner-tunable `mcp` limit needs a config edit + migration (not "no migration"); `verify_jwt=false` is *mandatory* (opaque bearer isn't a Supabase JWT), not just a CORS nicety; the mcp function is another service-role consumer → ADR + update the stale `admin.ts` "one caller" comment; stored-refresh-token collides with rotation; `mcp` must be added to the literal `deploy.yml` loop; auth (WS3) must precede the function's acceptance (WS4). |
| **2 — multi-browser** | needs-fixes | **false** | The drag lifecycle lives in **`src/hooks/use-free-drag.ts`** (window listeners 195-197), NOT `use-grid.ts:72-73` — the `setPointerCapture` fix belongs there and covers grid/staging/cluster-drag; add `workbox-precaching`/`workbox-routing` as explicit devDeps (only transitively present); add an auth-route denylist to the offline `NavigationRoute`; install webkit/firefox binaries locally first; 11 desktop specs + 1 mobile spec, not "12 each"; **reorder WS4 (sw.ts) before WS3 (real-device push sign-off)**. |
| **3a — pricing** | needs-fixes | **false** | `precheck` is NOT the sole AI gate — `run-plan.ts:59` + the parallel `precheckForUser`/`dispatch-messages` proactive path exist, so tier gating **must also** be added to `precheckForUser` (else Free users keep getting managed-AI push — the biggest omission); `adminClient()` already has 3 callers (webhook is the 4th), the "one caller" comment is stale; add a `subscription_by_user` DEFINER RPC for the JWT-less path; spell out the `route.ts` union/map edits; **gate the enforcement flip behind a flag until Stripe + the grandfather-seed are live** or ship W1-3+seed atomically. |
| **3b — infra** | needs-fixes | **false** | `history` is NOT immutable (`20260705000000_history_delete_policy.sql` grants owner-scoped delete) — the "permanent contract" risk is moot; the deploy loop is a literal 7-function list (not 4) → `dispatch-user` must be added explicitly; `notification_candidates()` RPC already exists → build `dispatch_tick()` on it; the dispatch secret must NOT be hardcoded in a migration (use Vault) and this newly puts it in the DB; standalone timestamp btrees are required for range-delete pruning; pg_cron/pg_net work on Free (WS1 not blocked by WS3); size compute *after* WS1's load profile. |
| **4 — ios** | needs-fixes | **false** | Backend is NOT "100% reused" — VAPID Web Push can't reach an iOS WKWebView/native, so push needs a new server-side APNs sender + device-token table (push reuse ≈ 0%, rung 2 reuse < 95%); surface APNs as a rung-2 prerequisite; add native auth session handling (Keychain + deep-link callback) and the `@todoclaw/logic` versioning contract; reassert ANON-key-only for supabase-swift; reconcile the "rung 1 shipped" vs "depends on Phase 2" inconsistency (Phase 2 hardens, doesn't build); clarify which mobile UX the native grid reimplements. |
