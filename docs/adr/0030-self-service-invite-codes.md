# ADR-0030 — Self-service invite codes (redeem a code → account, no dashboard)

**Date:** 2026-07-07 · **Stage:** post-launch

Adding a user meant the owner opening the Supabase Auth dashboard and inviting them by email
(ADR-0014, `docs/SERVICES.md`). The owner wanted to onboard someone from their phone by texting a
link — no dashboard, no needing the person's email up front. This adds an owner-generated,
redeemable **invite code** that creates the account through the service-role admin API, gated by a
valid code. It crosses the auth security boundary (a public account-creation path), hence this ADR.

**Signup stays disabled — this does not reopen self-registration.** `enable_signup = false` is
unchanged. Accounts are created only by the `redeem-invite` Edge Function via
`auth.admin.createUser` (which bypasses that flag), and only when a code passes an atomic claim. The
frontend still has no open sign-up form; the redeem form only works with a code.

Decisions:

- **An invite code is a bearer token that spends the owner's money.** Every account is a trusted
  user on the owner's Anthropic key (ADR-0014/0015), so a leaked/forwarded code = an unauthorized
  user on the bill. The controls bound that: **128-bit** codes (Crockford base32 — entropy is the
  primary guard), **single-use by default** (`max_uses = 1`), an **expiry** (default 7 days), owner
  **revoke**, and a **per-IP throttle** on redeem (defense-in-depth). The existing per-user rate
  limits + monthly budget kill-switch remain the ultimate backstop, so a leak is capped, not
  catastrophic.

- **Generic redeemable code, not an email-scoped Supabase invite link.** Supabase's
  `generateLink`/`inviteUserByEmail` are email-scoped (safer, less code) but require knowing the
  invitee's email first — which defeats the "text anyone a code" goal. We chose the generic code and
  accept the extra surface, hardened as above.

- **The service-role key is fenced to one function, one call.** `auth.admin.createUser` has no
  non-admin path, so `_shared/admin.ts` is the codebase's single service-role client, used only by
  `redeem-invite`. Everything else stays least-privilege: the claim / release / throttle logic lives
  in `SECURITY DEFINER` RPCs (`20260707044212_invites.sql`) granted to `service_role` **only** — so
  the whole invite mechanism is off the public PostgREST surface (mirrors the `ai_budget_ledger`
  fencing). `claim_invite_code` is a row-locked check-then-increment, so two people can't both redeem
  the last use; a `createUser` failure (e.g. duplicate email) releases the claim so the code isn't
  burned.

- **Owner gate is server-side.** `generate-invite` is owner-only via the `OWNER_USER_ID` secret
  (unset ⇒ nobody can generate — safe default). The frontend `VITE_OWNER_USER_ID` only *reveals* the
  "Invite someone" UI (a user id isn't secret); forcing it true still yields a 403.

- **Redeem is a pre-auth hash surface.** A texted `…/#/redeem?code=…` link lands a session-less
  visitor on a redeem form (code pre-filled); on success the client immediately signs in with the
  credentials it just set. Read from `location.hash` directly, not `lib/route`'s `AppRoute` union
  (which is for the signed-in shell).

- **Immediate activation (`email_confirm: true`).** The code is the owner's vouch, so a redeemed
  account is usable at once — no email-confirmation round-trip to configure for arbitrary invitees.
  Trade-off: it doesn't prove the redeemer owns the email. Acceptable given the code already gates
  entry; requiring confirmation later is a one-line change.

- **Codes stored in plaintext.** So the owner can re-copy a link later from the Invite panel. A
  hashed-at-rest variant is possible but loses re-share; given single-use + expiry + revoke and the
  low stakes (invite codes, not passwords), plaintext is the right trade for this app.

**Data model.** Three tables: `invites` (owner-RLS: list/revoke), `invite_redemptions` (audit, one
row per redemption, supports `max_uses > 1`), `invite_attempts` (throttle log; RLS on, no
grants/policies).

**Deferred.** Automated SMS (the owner shares the link via their own Messages app — no Twilio);
re-adding the per-user AI consent gate (ADR-0015, still deferred); per-invite AI budget caps (the
global kill-switch governs cost).

**Owner setup.** `supabase secrets set OWNER_USER_ID=<uuid>`; Vercel env `VITE_OWNER_USER_ID=<uuid>`;
`SUPABASE_SERVICE_ROLE_KEY` is platform-injected. `enable_signup` stays `false`.

**Verified.** Deno unit tests (code generator), frontend typecheck/lint/format, and a local
end-to-end pass (generate → redeem deep link → signed in; reuse → used-up; bad/revoked code →
rejected; non-owner → 403).
