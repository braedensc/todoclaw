# Todoclaw Scaling Roadmap

**Status:** planning · drafted 2026-07-08 · MVP → broader audience

Four workstreams to take Todoclaw from a handful of trusted testers to a paying
audience, plus the infrastructure scaling triggers underneath them. The order is
not arbitrary: each thread lowers the cost or unlocks the reach the next one needs.

The detailed, file-level plan lives in [`ROADMAP-IMPLEMENTATION.md`](./ROADMAP-IMPLEMENTATION.md).

---

## Anchoring decision — hybrid AI economics

The planner works fully without AI (a hard invariant), which makes the pricing
model fall out naturally:

- **Free** — full planner, no AI. ~$0 marginal cost.
- **BYO-AI (via MCP)** — the user connects Todoclaw to their own Claude/ChatGPT
  subscription; **inference runs on their wallet**, only cheap RLS-scoped tool
  execution runs on ours.
- **Pro (managed)** — we run the AI, metered by the **per-user monthly budget
  ledger that already ships** (`ai_user_budget_ledger`).

**Consequence for launch:** "ship commercially to real users" ≠ "enable
payments." Under the hybrid model we can launch broadly on **Free + BYO-AI with
no billing system at all**. Stripe only gates the managed Pro tier.

---

## The sequence

| Phase | Theme | Goal | Effort |
|---|---|---|---|
| **0 — now** | Stabilize the wallet | Cost optimization | M · days |
| **1 — next** | Offload with MCP | BYO-AI leg of the hybrid model | S tools · L auth |
| **2 — then** | Reach every browser + install | Multi-browser + PWA on-ramp | S–M |
| **3 — when growing** | Recoup + hold under load | Managed Pro tier + infra cutover | L billing · M infra |
| **4 — separate project** | Go native | iOS, its own session | L |

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

*Sequence and cost figures are estimates for planning, not commitments. Grounded in
the codebase as of 2026-07-08: model `claude-sonnet-5` hardcoded at `anthropic.ts`,
no `app_config` write path, guardrails in `guardrails-constants.ts`, dispatcher in
`dispatch-messages/index.ts`, no Realtime (ADR-0021, TanStack Query fetch-on-focus).*
