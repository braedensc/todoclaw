# Todoclaw Scaling Roadmap

**Status:** planning · drafted 2026-07-08 · MVP → broader audience

A sequenced set of workstreams to take Todoclaw from a handful of trusted testers to a
paying audience, plus the infrastructure scaling triggers underneath them. The order is
not arbitrary: each thread lowers the cost or unlocks the reach the next one needs.

The detailed, file-level plan lives in [`ROADMAP-IMPLEMENTATION.md`](./ROADMAP-IMPLEMENTATION.md).

---

## Anchoring decision — hybrid AI economics

The planner works fully without AI (a hard invariant), which makes the pricing
model fall out naturally:

- **Guest** — no login, one tap to try. A small, strictly-metered taste of the AI on the
  cheapest model, in its own isolated budget bucket. The acquisition top of the funnel.
- **Free** — full planner, no AI. ~$0 marginal cost.
- **BYO-AI (via MCP)** — the user connects Todoclaw to their own Claude/ChatGPT
  subscription; **inference runs on their wallet**, only cheap RLS-scoped tool
  execution runs on ours.
- **Pro (managed)** — we run the AI, metered by the **per-user monthly budget
  ledger that already ships** (`ai_user_budget_ledger`).

**Consequence for launch:** "ship commercially to real users" ≠ "enable
payments." Under the hybrid model we can launch broadly on **Free + BYO-AI with
no billing system at all**. Stripe only gates the managed Pro tier.

**Decisions locked (2026-07-08):**
- **Payments last, decoupled from launch** — go live on Free + BYO-AI without Stripe.
- **The admin panel is a control plane** — every operational setting (model, caps, budget
  buckets, rate limits, tier mappings, feature flags) is a DB-backed, live-editable knob,
  changeable from the in-app panel with no redeploy. It runs *across* every phase.
- **Guest tier is dead last, behind a security audit** — it opens publicly-creatable
  sessions, so it ships only on a hardened, audited base, with an isolated guest budget.

---

## The sequence

| Phase | Theme | Goal | Effort |
|---|---|---|---|
| **0 — now** | Stabilize the wallet | Cost optimization | M · days |
| **1 — next** | Offload with MCP | BYO-AI leg of the hybrid model | S tools · L auth |
| **2 — then** | Reach every browser + install | Multi-browser + PWA on-ramp | S–M |
| **3 — when growing** | Recoup + hold under load | Managed Pro tier + infra cutover | L billing · M infra |
| **4 — separate project** | Go native | iOS, its own session | L |
| **5 — dead last** | Guest / anonymous tier | Acquisition funnel (after a security audit) | M |

> **Cross-cutting — the admin control plane.** Not a phase; it grows with every one. Each
> phase's settings (model, caps, budget buckets, rate limits, tier mappings, feature flags)
> become **live-editable knobs** in the owner panel — DB-backed config that takes effect on
> the next request with no redeploy. See the implementation plan's "Admin control plane".

### Phase 0 — Stabilize the wallet *(cost optimization)*
- Rework the shared **$20/mo global AI cap** so it scales with active users — two
  users at the per-user cap already exhaust it, and it trips AI for *everyone*.
- Ship the **admin model switch**: add a write path to `app_config` (only the read
  path exists today), thread a model field through `loadConfig`, make `costMicros`
  model-aware (pricing is hardwired to Sonnet-5).
- Run chat on **Haiku 4.5** (~10× cheaper); reserve Sonnet/Opus for Plan-My-Day.
- Turn on **prompt caching** for the static system prompt + tool schemas.

### Phase 1 — Offload with MCP *(BYO-AI)*
- A **second adapter** over the existing `CAPABILITIES` registry — the layer was
  built for exactly this. Tool exposure is small.
- The real work is **OAuth 2.1** so a user's Claude/ChatGPT client authenticates and
  tool calls run under the right JWT-scoped Supabase client.
- Target Claude connectors first (ChatGPT MCP is newer/gated). Keep server-side
  destructive-action classification and rate-limit the MCP endpoint.

### Phase 2 — Reach every browser + install *(multi-browser + PWA)*
- Add **WebKit + Firefox** projects to the golden Playwright suite (Edge = Chromium,
  so "Chrome + Edge" is one target).
- Manual pass on real desktop Safari + a physical iPhone: web push (iOS needs an
  installed PWA), the pointer-event drag grid, SSE chat streaming, viewport quirks.
- **PWA polish** — manifest, icons, install prompt, offline shell. Unlocks iOS push
  and is the native on-ramp.

### Phase 3 — Recoup + hold under load *(pricing + infra)*
- **Stripe** (Checkout + Billing + webhooks) → an `entitlements` table. Tiers: Free /
  BYO-AI / Pro. Metering substrate already exists in `ai_user_budget_ledger`.
- Sell on the **web**, not in-app, to avoid Apple's 15–30% cut.
- Infra, pulled in by the tier triggers below: **fan out the hourly dispatcher**, add
  **retention/pruning** for unbounded tables, cut over to **Supabase Pro + Vercel Pro**.

### Phase 4 — Go native *(separate project)*
- Climb the ladder, don't leap: **PWA** (Phase 2) → **Capacitor wrap** → **React
  Native / Swift** only when PMF justifies rewriting the grid.
- Backend reuse is total; the free-canvas drag grid is the entire lift.
- Full native is the only path that unblocks the benched Apple Reminders / EventKit
  integration.

### Phase 5 — Guest / anonymous tier *(dead last — behind a security audit)*
- No-login "just try it" funnel: an anonymous visitor gets a small, cheap, strictly-metered
  taste of the AI, then converts to Free/Pro.
- Runs on **Supabase Anonymous Sign-Ins** (a real `auth.users` row + JWT, so RLS, tools,
  and the budget ledger all work unchanged); **link-identity** on sign-up keeps their tasks
  — the conversion hook.
- **Isolated guest budget bucket + its own kill-switch** (never draws down the paid pool),
  cheapest model, reduced toolset; **CAPTCHA + per-IP** creation throttle.
- Sequenced last because it opens publicly-creatable sessions — the biggest attack-surface
  change — so it ships only on a hardened, audited base.

---

## Infrastructure — where it breaks, and the trigger to migrate

Nothing bills us except Anthropic. Free tiers *pause* rather than invoice — a wall,
not a surprise.

| Tier | Users | What breaks first | Migration action | ~Cost |
|---|---|---|---|---|
| **0 · now** | 5–20 | Shared **$20/mo global AI cap** trips → AI off for everyone | Rework the cap to scale with active users | $0 |
| **1** | 50–200 | **Supabase Free** ceilings (~500 MB DB, ~5 GB egress, inactivity pause); **Vercel Hobby** forbids commercial use | Supabase Pro + Vercel Pro | ~$45/mo |
| **2** | 500–2k | **Hourly dispatcher** — serial invocation, synchronous Anthropic + push per due user — blows the wall-clock; unbounded tables never prune | Fan out the dispatcher (queue / pgmq / pg_cron); retention jobs; compute add-on | ~$75–150/mo |
| **3** | 5k+ | DB compute, egress, connection pooling | Dedicated compute, read replicas, table partitioning | proportional |

---

## Flag now, not later

- **The $20 global cap** — the most immediate constraint. Raise it before widening
  invites, independent of every larger thread.
- **Vercel Hobby is non-commercial** — the moment we charge, its ToS is violated.
  Move to Vercel Pro alongside Stripe.
- **Apple's IAP tax** — selling subscriptions inside an iOS app owes Apple 15–30%.
  Keep checkout on the web.

### Legal / infra prerequisites, by when they bite
- **ToS + Privacy Policy** — at *public launch* (personal data, AI, push). Earlier
  than payments.
- **Supabase Pro + Vercel Pro** — at the *reliability / commercial* threshold
  (Tier 1). Slightly ahead of payments.
- **Refund policy, Stripe Tax/VAT, business entity** — only at *payment enablement*.
  The true last mile.

---

## Security hardening gates

Where the phases above sequence the *product*, this sequences the *security work* that
gates each audience widening. Sourced from a repo-grounded audit (2026-07-13) across auth,
RLS, web/supply-chain, abuse/cost, privacy, payments, and observability.

**The isolation base is already sound — this is about scaling the trust base, not patching a
leak.** Verified 2026-07-13: no secrets in the frontend bundle (the 5 `VITE_*` vars are all
public-by-design); RLS enabled on 17/17 tables with no `anon` grants or `using(true)`
policies; all 63 `SECURITY DEFINER` functions correctly fenced (every `p_user_id`-taking one
is `service_role`-only, `authenticated`-callable ones derive the user from `auth.uid()`); no
RLS-bypassing views; every edge function gated (`requireUser`, the `DISPATCH_SECRET` cron
header, or invite-code + IP throttle). So the items below are about **availability, legal,
config-verifiability, and log hygiene — not confidentiality.**

**Gates:** **G1** wider private beta (more invited, still trusted) · **G2** public free launch
(anyone signs up, Free + BYO-AI, no payments) · **G3** monetization (Stripe, paid Pro) ·
**G4** guest/anonymous tier (Phase 5 — publicly-creatable sessions, the biggest surface change).

### G2 — cannot open public signups without these

The blocker set. Each is a hard prerequisite the moment a stranger can create an account:

1. **Automated cross-tenant RLS tests** — prove user B can't read/write user A's rows on all
   17 tables. Zero coverage today; one silent policy regression = mass leak. *The single most
   important control — cheap, do it first.*
2. **Isolated per-tier AI budget buckets** — kill the shared-pool DoS. `ai_budget_add` (granted
   to `authenticated`) writes the **global** ledger, so two public users at the $10/user cap
   exhaust the $20 global cap and pause AI for everyone. (Converges with Phase 0.)
3. **Privacy Policy + Terms of Service** (+ subprocessor disclosure / DPAs: Anthropic, Supabase,
   Vercel, Sentry) — legal gate before confessional-PII accounts exist. A G2 trigger, not G3.
4. **Right-to-erasure / self-serve account deletion** — GDPR Art.17 / CCPA. FK `on delete
   cascade` is already correct, so this is a delete-account edge fn + Settings "danger zone" +
   backup purge; today deletion is manual dashboard surgery.
5. **Auth trust trio** — leaked-password (HIBP) enforcement + email-confirmation enforcement +
   self-serve password reset. Today confirmations are off in config, HIBP is an unverifiable
   dashboard toggle, and reset is owner-manual.
6. **Auth-email SPF/DKIM/DMARC** on an owned sender domain — confirmation/reset silently depend
   on transactional email the built-in Supabase sender won't deliver reliably at signup scale.
7. **CAPTCHA / bot mitigation on account creation** — flipping `enable_signup=true` with only
   IP rate limits invites account-farming (each account a fresh AI sub-cap against the owner key).
8. **Production auth config version-controlled + verifiable** — every prod auth setting (HIBP,
   confirm-email, session timebox, password policy) is an un-versioned dashboard toggle; you
   can't safely flip `enable_signup` without confirming these are on and drift-protected.
9. **Sentry `beforeSend` PII scrubber, confirmed on the prod DSN** — Sentry is active with none;
   task text / titles / email can flow to a third-party processor unscrubbed today.

### By gate

**G1 — do now, regardless (cheap, high-leverage):** the automated RLS isolation tests (#1
above); a CI guard that every new `public` table has RLS + an owner policy; the Sentry PII
scrubber; strip PII from `ai-chat` `console.error` logs; alert when the global AI kill-switch
trips; test backup **restore** (not just backup); owner-account **MFA + break-glass** (the owner
account is the whole-tenant blast radius — service_role, admin panel).

**G2 — beyond the blocker set:** raise min password length 6→≥8 + complexity, session timebox +
inactivity timeout, reauth-on-password-change, CAPTCHA on sign-in, rate-limit the
password-reset/confirmation-resend endpoints; move JWT+refresh off `localStorage` → httpOnly
cookies (needs SSR) **or** ship a strict **Content-Security-Policy** + confirm refresh
rotation/reuse-detection; security headers (HSTS, frame-ancestors, nosniff, Referrer-Policy,
Permissions-Policy) via `vercel.json`; pin GitHub Actions to SHAs in secret-bearing jobs;
`npm audit` in CI + Dependabot; abort-proof usage recording; per-turn input cap that also covers
array/structured content; edge WAF/bot mitigation; **code-level containment of stored/LLM
prompt-injection once chat+memory persist**; data retention/pruning, export/portability,
cookie/consent, age gating (COPPA), consent capture at signup, breach-notification process;
immutable audit log of admin actions, per-user ban + force session revocation, incident runbook +
`security.txt`.

**G3 — monetization (build when Stripe lands):** Stripe **webhook signature verification on the
raw body**; **server-authoritative entitlements** (RLS select-own, writes only via a
`service_role` DEFINER upsert, user resolved from Stripe metadata not email); **no client-trusted
tier**; webhook idempotency + replay protection; subscription reconciliation (cancellation,
`past_due` dunning, chargeback → revoke); tier gating in **both** AI paths (chat + dispatch); safe
tier→budget-bucket mapping (a paying user must never be denied by the shared cap); PCI scope
minimization (hosted Checkout = SAQ-A, never touch card data); fix the multi-iteration spend
under-record vs the $0.20 clamp **before charging**; an **independent penetration test** before
taking money.

**G4 — guest / anonymous tier (dead last):** anonymous sign-in behind **CAPTCHA + a fail-closed,
spoof-resistant creation throttle**; **isolated guest budget bucket** with its own kill-switch;
reduced toolset; anonymous-session PII lifecycle (auto-purge un-converted guests); full
security-header completeness; a **documented guest-tier threat model / abuse tree** authored
before the build.

**Cross-cutting:** an **SSRF / egress allowlist** on edge-function outbound fetch (critical for
the BYO-AI/MCP leg, Phase 1); a defined **pre-gate security-review checkpoint** before each gate
flip; MFA availability at G3. The planned BabyClaw chat+memory persistence work directly satisfies
several G2 items (LLM-injection containment, right-to-erasure, no-PII-in-logs) — ship them together.

---

*Sequence and cost figures are estimates for planning, not commitments. Grounded in
the codebase as of 2026-07-08: model `claude-sonnet-5` hardcoded at `anthropic.ts`,
no `app_config` write path, guardrails in `guardrails-constants.ts`, dispatcher in
`dispatch-messages/index.ts`, no Realtime (ADR-0021, TanStack Query fetch-on-focus).*
