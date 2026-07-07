# ADR-0029 — Per-user AI spend alert (owner webhook)

**Date:** 2026-07-07 · **Stage:** post-launch (security/observability)

## Context

The AI guardrails (ADR-0015 + the 2026-07-06 hardening) **bound** spend but only ever **block**: a
global `$20/month` kill-switch, a per-user `$10/month` sub-cap, and per-user rate limits. When an
account misbehaves — a leaked token, an abusive user, a runaway integration — the system silently
absorbs it up to the per-user cap and the owner is never told. There was **no detection layer**:
nothing said "user X is spending too much," which is exactly the signal that surfaces misuse or a
compromised account. The owner would only find it by manually querying the ledger tables.

## Decision

Add a **detection** layer alongside the existing prevention. When a user's cumulative monthly spend
first crosses `USER_SPEND_ALERT_MICROS` (`$8` = 80% of the per-user sub-cap), fire a **one-off
webhook to the owner**. This is a notification, not a block — it fires _before_ the wall so the owner
can act while the account can still spend.

- **Where:** `recordUsage` (`_shared/guardrails.ts`) — the single post-call choke-point both chat and
  Plan My Day already funnel through. After recording spend it reads the caller's new monthly total
  (`ai_user_budget_check`), reconstructs the pre-call total from what this call added, and pages once
  on the crossing (`crossedSpendAlert`: `prev < threshold ≤ next`). Spend only increments and each
  add is clamped below the threshold, so the crossing is always caught and paged **exactly once per
  user per month**.
- **Transport:** `_shared/spend-alert.ts` POSTs to `AI_SPEND_ALERT_WEBHOOK_URL`. The body sets both
  `text` (Slack) and `content` (Discord) to one human line, plus structured fields, so a plain
  incoming webhook of either flavor — or any other receiver — works with no extra config.
- **Identity:** the crossing (rare) lazily fetches the user id + email from the JWT to name the
  account in the alert.

## Why this shape

- **No migration / no SQL change.** It reuses the existing per-user ledger and the
  `ai_user_budget_check` RPC; it does not touch the hardened SECURITY DEFINER functions. Lower risk,
  and it sidesteps cross-worktree migration serialization.
- **Server-only secret, degrades to nothing.** `AI_SPEND_ALERT_WEBHOOK_URL` is an Edge Function
  secret, never a `VITE_*` var / never in the bundle (same posture as the Anthropic key). **Unset ⇒
  no-op**, so local dev, CI, and any deploy without it are unaffected — the alert is purely additive.
- **Best-effort.** Every failure path (unset URL, network, non-2xx) is swallowed; an alerting hiccup
  must never fail a user's already-completed AI request.

## Consequences / tunables

- One threshold today. A second lower band (e.g. an early $4 heads-up) is a one-line addition; the
  threshold and per-user cap both live as constants in `guardrails.ts`.
- Under concurrent same-user calls the pre-call total is reconstructed per call, so a crossing could,
  rarely, double-page or shift by one call. Acceptable for an invite-only app (low per-user
  concurrency); the alert is a heads-up, not an audit record.
- Not an admin dashboard and not anomaly/velocity detection — it is a single threshold crossing.
  A spend-velocity signal or an owner monitoring view remain possible follow-ups.

**Down path:** delete `_shared/spend-alert.ts` (+ its test), revert `recordUsage` to the 4-arg
signature and drop the `feature` arg at its three call sites, and remove the alert constants/helper
from `guardrails.ts`. No schema or data to reverse.
