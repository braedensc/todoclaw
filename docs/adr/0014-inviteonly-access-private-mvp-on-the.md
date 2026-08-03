# ADR-0014 — Invite-only access (private MVP on the owner's key)

**Date:** 2026-06-24 · **Stage:** 4 (PR1) · **Status:** Accepted

The Stage 4 MVP is a **private, invite-only app** (Braeden + a small circle of friends/family)
running AI on Braeden's own Anthropic key. Access is closed at two layers:

- **Supabase Auth (dashboard, human-only):** public sign-up **disabled**; accounts are created
  by owner **invite-by-email**. This is the actual gate — the database simply has no path to a
  self-created account.
- **Frontend (`AuthForm.tsx`):** **sign-in-only**. The sign-up mode/toggle/`signUp` call were
  removed; the form only ever calls `signInWithPassword`. There is no account-creation affordance
  in the client at all (defense in depth + honest UX — the button can't promise what the backend
  refuses).

**Why this shape.** Because everyone who can sign in is invited and trusted, a large amount of
complexity collapses: there is **no BYOK, no per-user key resolution, and no allowlist table** —
"who is invited" is exactly "who has an account." That trust is also what lets AI run on the
**owner's key** for every signed-in user (see ADR-0015) instead of each user supplying their own.

**Deviation from the master plan, recorded deliberately.** The master plan's CLAUDE.md Hard Rule
#6 frames AI as "opt-in, off by default." For the invite-only MVP that consent gate is **dropped
for now** (Braeden's call, 2026-06-24): AI is available to every signed-in user, with cost bounded
by the owner-key guardrails (ADR-0015) rather than per-user consent. The architecture leaves room
to re-add a thin consent layer later (a boolean + a one-time notice) without reworking anything.
The planner remains **fully usable without AI** regardless.

**Deferred (NOT this stage).** A public version: the trustworthy paths are OpenRouter OAuth
(user-funded, capped, no key paste) or a paid SaaS (Stripe); raw "paste your key" BYOK is rejected
as a front door. Anthropic offers no third-party billing OAuth, so direct-Anthropic public sharing
would force raw BYOK — avoid. If/when sign-up opens, add Cloudflare Turnstile CAPTCHA on auth (not
needed while invite-only).
